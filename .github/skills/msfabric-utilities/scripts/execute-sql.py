import struct
import mssql_python
import sys
import argparse
import csv
import time
import json
import os
import base64
from datetime import datetime
from azure.identity import AzureCliCredential

# Preset server profiles (alias -> server mapping). Add more profiles here as needed
SERVER_PROFILES = {
    'default': 'haesbr3x7lfe3g4fiypah5yfea-xazde4v3pg2uzjuoru5i5omfd4.datawarehouse.fabric.microsoft.com',
    'develop': 'haesbr3x7lfe3g4fiypah5yfea-xazde4v3pg2uzjuoru5i5omfd4.datawarehouse.fabric.microsoft.com',
    # 'uat': 'your-uat-server.datawarehouse.fabric.microsoft.com',
    # 'prod': 'your-prod-server.datawarehouse.fabric.microsoft.com',
}

def resolve_server(profile_or_server):
    """Resolve profile name to server, or return server if it's already a full path"""
    
    if profile_or_server in SERVER_PROFILES:
        return SERVER_PROFILES[profile_or_server]
    return profile_or_server

def extract_email_from_token(token_str):
    """Extract email from JWT token"""
    try:
        # JWT tokens have 3 parts separated by dots: header.payload.signature
        parts = token_str.split('.')
        if len(parts) != 3:
            return None
        
        # Decode the payload (add padding if needed)
        payload = parts[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += '=' * padding
        
        decoded_payload = base64.urlsafe_b64decode(payload)
        claims = json.loads(decoded_payload)
        
        # Extract email from claims (could be 'email', 'upn', or 'preferred_username')
        email = claims.get('email') or claims.get('upn') or claims.get('preferred_username')
        return email
    except Exception as e:
        print(f"[WARNING] Could not extract email from token: {str(e)}", file=sys.stderr)
        return None
    
def get_conn():
    credential = AzureCliCredential()
    token = credential.get_token("https://database.windows.net/.default")
    email = extract_email_from_token(token.token)
    print(f"[INFO] Authenticated with AzureCliCredential: {email}", file=sys.stderr)
    token_bytes = token.token.encode("utf-16le")
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    return token_struct

SQL_COPT_SS_ACCESS_TOKEN = 1256

def execute_sql(sql_server, sql_database, sql_command):
    """Execute SQL command on Microsoft Fabric SQL endpoint"""
    
    try:
        # Build connection string with access token
        print(f"[INFO] Connecting to server: {sql_server}, Database: {sql_database}", file=sys.stderr)
        connection_start = time.time()
        connection_string = f"SERVER=tcp:{sql_server},1433;DATABASE={sql_database};"
        
        connection = mssql_python.connect(connection_string, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: get_conn()})
        cursor = connection.cursor()
        
        connection_duration = time.time() - connection_start
        print(f"[INFO] Connection established in {connection_duration:.3f} seconds", file=sys.stderr)
        
        # Track query execution duration
        print(f"[INFO] Executing query...", file=sys.stderr)
        query_start = time.time()
        
        cursor.execute(sql_command)
        
        # Fetch results if it's a SELECT query
        rows = cursor.fetchall()
        
        query_duration = time.time() - query_start
        print(f"[INFO] Query executed in {query_duration:.3f} seconds", file=sys.stderr)
        print(f"[INFO] Rows returned: {len(rows)}", file=sys.stderr)
        
        # Generate timestamp-based filenames
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
        os.makedirs(output_dir, exist_ok=True)
        
        csv_file = os.path.join(output_dir, f"query_result-{timestamp}.csv")
        json_file = os.path.join(output_dir, f"query_result-{timestamp}.json")
        
        # Prepare metadata
        metadata = {
            "output_csv": csv_file if len(rows) > 0 else None,
            "elapsed_connection": round(connection_duration * 1000),  # milliseconds
            "elapsed_query": round(query_duration * 1000)  # milliseconds
        }
        
        # Save CSV only if there are rows
        if len(rows) > 0:
            with open(csv_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                
                # Write header if columns are available
                if cursor.description:
                    headers = [column[0] for column in cursor.description]
                    writer.writerow(headers)
                
                # Write data rows
                writer.writerows(rows)
            
            print(f"[INFO] Results saved to: {csv_file}", file=sys.stderr)
        else:
            print(f"[INFO] No rows returned, skipping CSV creation", file=sys.stderr)
        
        # Save metadata
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"[INFO] Metadata saved to: {json_file}", file=sys.stderr)
        
        cursor.close()
        connection.close()
        
    except Exception as e:
        print(f"[ERROR] Error executing SQL: {str(e)}", file=sys.stderr)
        print(f"[ERROR] Exception type: {type(e).__name__}", file=sys.stderr)
        sys.exit(1)
        

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Execute SQL commands on Microsoft Fabric SQL endpoint',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    
    # Accept profile name or full server path
    parser.add_argument(
        '--sql-profile',
        default='default',
        help='SQL server profile name (default: "default") or full server endpoint'
    )
    
    parser.add_argument(
        '--sql-database',
        required=True,
        help='SQL database name'
    )
    
    parser.add_argument(
        '--sql-command',
        required=True,
        help='SQL command to execute'
    )
    
    args = parser.parse_args()
    
    # Resolve profile name to actual server
    actual_server = resolve_server(args.sql_profile)
    
    execute_sql(actual_server, args.sql_database, args.sql_command)
