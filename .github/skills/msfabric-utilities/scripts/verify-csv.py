import os
import csv
import sys
import argparse
from pathlib import Path

def read_csv_file(filepath):
    """Read CSV file and return rows and metadata"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            headers = next(reader, None)
            rows = list(reader)
        
        return {
            'headers': headers,
            'rows': rows,
            'row_count': len(rows),
            'column_count': len(headers) if headers else 0
        }
    except Exception as e:
        print(f"[ERROR] Failed to read {filepath}: {str(e)}", file=sys.stderr)
        return None

def compare_csv_files(file1, file2):
    """Compare two CSV files"""
    data1 = read_csv_file(file1)
    data2 = read_csv_file(file2)
    
    if data1 is None or data2 is None:
        return None
    
    print(f"\n[INFO] Comparing query results", file=sys.stderr)
    print(f"[INFO] File 1: {os.path.basename(file1)}", file=sys.stderr)
    print(f"[INFO] File 2: {os.path.basename(file2)}", file=sys.stderr)
    print("", file=sys.stderr)
    
    # Compare metadata
    print(f"[INFO] File 1 - Rows: {data1['row_count']}, Columns: {data1['column_count']}", file=sys.stderr)
    print(f"[INFO] File 2 - Rows: {data2['row_count']}, Columns: {data2['column_count']}", file=sys.stderr)
    
    results = {
        'file1': os.path.basename(file1),
        'file2': os.path.basename(file2),
        'headers_match': data1['headers'] == data2['headers'],
        'row_count_match': data1['row_count'] == data2['row_count'],
        'data_match': False,  # Will be calculated after sorting
        'file1_rows': data1['row_count'],
        'file2_rows': data2['row_count'],
        'differences': []
    }
    
    # Check headers
    if not results['headers_match']:
        print(f"\n[WARNING] Column headers differ", file=sys.stderr)
        print(f"  File 1: {data1['headers']}", file=sys.stderr)
        print(f"  File 2: {data2['headers']}", file=sys.stderr)
        results['differences'].append('Headers do not match')
    else:
        print(f"\n[INFO] Column headers match: {data1['headers']}", file=sys.stderr)
    
    # Check row counts
    if not results['row_count_match']:
        print(f"[WARNING] Row counts differ", file=sys.stderr)
        print(f"  File 1: {data1['row_count']} rows", file=sys.stderr)
        print(f"  File 2: {data2['row_count']} rows", file=sys.stderr)
        results['differences'].append(f"Row count mismatch: {data1['row_count']} vs {data2['row_count']}")
    else:
        print(f"[INFO] Row counts match: {data1['row_count']} rows", file=sys.stderr)
    
    # Check data - sort rows before comparing
    if results['headers_match'] and results['row_count_match']:
        # Sort both datasets before comparison
        sorted_rows1 = sorted(data1['rows'])
        sorted_rows2 = sorted(data2['rows'])
        data_match = sorted_rows1 == sorted_rows2
        results['data_match'] = data_match
        
        if data_match:
            print(f"[INFO] Data content matches perfectly (after sorting)", file=sys.stderr)
        else:
            print(f"[WARNING] Data content differs (even after sorting)", file=sys.stderr)
            # Find first difference
            for idx, (row1, row2) in enumerate(zip(sorted_rows1, sorted_rows2)):
                if row1 != row2:
                    print(f"  First difference at sorted row {idx + 1}:", file=sys.stderr)
                    print(f"    File 1: {row1}", file=sys.stderr)
                    print(f"    File 2: {row2}", file=sys.stderr)
                    results['differences'].append(f"Data differs at sorted row {idx + 1}")
                    break
    
    # Summary
    print("", file=sys.stderr)
    if not results['differences']:
        print("[INFO] ✓ Query results match!", file=sys.stderr)
    else:
        print("[WARNING] ✗ Query results differ", file=sys.stderr)
        for diff in results['differences']:
            print(f"  - {diff}", file=sys.stderr)
    
    print("", file=sys.stderr)
    return results

def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Compare two CSV query result files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        add_help=False,
        epilog="""
Examples:
  python verify-csv.py file1.csv file2.csv
  python verify-csv.py output/query_result-1.csv output/query_result-2.csv
        """
    )
    
    parser.add_argument(
        'csv_file_1',
        help='Path to the first CSV file'
    )
    
    parser.add_argument(
        'csv_file_2',
        help='Path to the second CSV file'
    )
    
    args = parser.parse_args()
    
    # Validate files exist
    if not os.path.exists(args.csv_file_1):
        print(f"[ERROR] File not found: {args.csv_file_1}", file=sys.stderr)
        sys.exit(1)
    
    if not os.path.exists(args.csv_file_2):
        print(f"[ERROR] File not found: {args.csv_file_2}", file=sys.stderr)
        sys.exit(1)
    
    # Compare the files
    compare_csv_files(args.csv_file_1, args.csv_file_2)
    sys.exit(0)

if __name__ == "__main__":
    main()
