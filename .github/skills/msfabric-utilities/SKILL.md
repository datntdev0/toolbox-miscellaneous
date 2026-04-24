---
name: msfabric-utilities
description: Utilities for Microsoft Fabric
user-invocable: false
---

# SKILL - Microsoft Fabric Utilities

This SKILL provides utility functions for Microsoft Fabric.

## Available Scripts

### Check Azure CLI Authentication Status

script: [scripts/check-azure-cli-auth.py](scripts/check-azcli.py)

#### Prerequisites
- Python 3.x
- Azure CLI installed and login with `az login`

#### Sample Usage
```bash
# Check Azure CLI authentication status
python check-azcli.py
```

### Executes a SQL query against a specified database and returns the results.

script: [scripts/execute-sql.py](scripts/execute-sql.py)

#### Prerequisites
- Python 3.x with `mssql_python` library installed

#### User Inputs
- `sql-database` (required): Asking the name of the SQL database to connect to.
- `sql-profile` (optional): Asking the name of the SQL profile to use for authentication.

#### Sample Usage
```bash
# Execute a SQL query using default profile defined in the script
python execute-sql.py --sql-database "<database_name>" --sql-command "<sql_query>"
# Execute a SQL query using a specific SQL profile
python execute-sql.py --sql-profile "<sql_profile>" --sql-database "<database_name>" --sql-command "<sql_query>"
# Execute a SQL query from a file
python execute-sql.py --sql-database "<database_name>" --sql-command "$(cat query_content.sql)"
```

### Verify and Compare Two CSV Query Results

script: [scripts/verify-csv.py](scripts/verify-csv.py)

#### Prerequisites
- Python 3.x with standard libraries (csv, json, argparse)

#### User Inputs
- `csv_file_1` (required): Path to the first CSV file
- `csv_file_2` (required): Path to the second CSV file

#### Sample Usage
```bash
# Compare two query result files
python verify-csv.py output/query_result-1.csv output/query_result-2.csv
# Compare with relative paths
python verify-csv.py ../output/result1.csv ../output/result2.csv
```

#### Output
The script provides:
- File comparison details (row counts, column names)
- Data content verification
- Summary of matches or differences
