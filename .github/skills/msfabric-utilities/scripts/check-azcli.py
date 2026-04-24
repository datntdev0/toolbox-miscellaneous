import subprocess
import sys
import json
import shutil

def is_azure_cli_installed():
    """Check if Azure CLI is installed"""
    return shutil.which('az') is not None

def get_azure_cli_version():
    """Get Azure CLI version"""
    try:
        result = subprocess.run('az --version', capture_output=True, text=True, timeout=10, shell=True)
        return result.stdout.strip()
    except Exception as e:
        return None

def get_current_account():
    """Get current signed-in account"""
    try:
        result = subprocess.run(
            'az account show',
            capture_output=True,
            text=True,
            timeout=10,
            shell=True
        )
        
        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            return None
    except Exception as e:
        print(f"[ERROR] Failed to retrieve account: {str(e)}", file=sys.stderr)
        return None

def show_signin_instructions():
    """Show instructions to sign in"""
    print("[ERROR] Not authenticated. Please run: az login", file=sys.stderr)

def format_account_info(account):
    """Format account info for display"""
    user_email = account.get('user', {}).get('name', 'N/A')
    tenant_display_name = account.get('tenantDisplayName', 'N/A')
    print(f"[INFO] Successfully retrieved current account: {user_email} | tenant: {tenant_display_name}", file=sys.stderr)

def main():
    """Main function"""
    print("[INFO] Checking Azure CLI installation...", file=sys.stderr)
    
    # Check if Azure CLI is installed
    if not is_azure_cli_installed():
        print("[ERROR] Azure CLI is not installed", file=sys.stderr)
        print("[INFO] Download from: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli", file=sys.stderr)
        sys.exit(1)
    
    # Get Azure CLI version
    version = get_azure_cli_version()
    if version:
        # Extract just the version number from the output (first line)
        version_line = version.split('\n')[0].strip()
        # Clean up extra spaces
        version_line = ' '.join(version_line.split())
        print(f"[INFO] Azure CLI is installed at {version_line}", file=sys.stderr)
    
    # Check current account
    print("[INFO] Checking current authentication status...", file=sys.stderr)
    account = get_current_account()
    
    if account is None:
        # Not signed in
        show_signin_instructions()
        sys.exit(0)
    
    # Display current account
    format_account_info(account)
    sys.exit(0)

if __name__ == "__main__":
    main()
