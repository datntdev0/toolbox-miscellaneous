# Fabric Pipeline Runs Viewer

A Blazor Server application for viewing Microsoft Fabric Pipeline activity runs.

## Features

- View pipeline run activity details from Microsoft Fabric
- Service Principal authentication (Client ID & Secret)
- Automatic pagination with continuation token support
- **Collapsible input panel** for cleaner UI (expand/collapse)
- **Import JSON file** from local storage for offline analysis
- **Dual view modes**:
  - **Table View**: Interactive table with activity details
  - **JSON Preview**: Raw JSON data display
- **Advanced table features**:
  - **Virtual scrolling** for high-performance rendering of large datasets
  - **Search** by activity name (real-time filtering)
  - **Sorting** by start time or duration (ascending/descending)
  - **Status filtering** (All, Succeeded, Failed, InProgress, Queued)
  - Clear filters button to reset all filters
- **Detailed activity information**:
  - Activity name, type, and status with icons
  - Start time, end time, and duration
  - Input/Output data in popup modals
- Download activity runs as JSON file with smart naming: `<pipeline_name>_<start_time>.json`
- Bootstrap 5 responsive UI

## Prerequisites

- .NET 9.0 SDK
- Microsoft Fabric workspace access
- Service Principal with appropriate permissions to access Fabric API

## Configuration

Update the `appsettings.json` (or `appsettings.Development.json`) with your Service Principal credentials:

```json
{
  "FabricApi": {
    "TenantId": "YOUR_TENANT_ID",
    "ClientId": "YOUR_CLIENT_ID",
    "ClientSecret": "YOUR_CLIENT_SECRET"
  }
}
```

### How to Get These Values

1. **TenantId**: Your Azure AD Tenant ID
2. **ClientId**: Service Principal (App Registration) Client ID
3. **ClientSecret**: Service Principal Client Secret

**Note:** WorkspaceId and DataPipelineId are now entered directly in the UI form.

### Service Principal Permissions

Ensure your Service Principal has:
- Fabric API permissions (`https://api.fabric.microsoft.com/.default`)
- Access to the workspace containing the pipeline

## Running the Application

```bash
cd datntdev.Fabric.PipelineRunsViewer
dotnet run
```

Navigate to `https://localhost:5001` (or the URL shown in the console).

## Usage

### Fetch from API

1. Go to the **Pipeline Runs** page from the home page
2. Expand input panel (if collapsed) by clicking **▼ Show Inputs**
3. Enter your **Workspace ID** (GUID)
4. Enter a valid **Fabric Pipeline Run ID**
5. (Optional) Set **Last Updated After** date filter
6. (Optional) Set **Last Updated Before** date filter
7. Click **Submit** to fetch all activity runs (input panel collapses automatically)
8. View results in **Table View** or **JSON Preview** tabs
9. Click **More Details** on Input/Output columns to see JSON data in popup modals
10. Click **Download JSON** to save the results

### Import from File

1. Go to the **Pipeline Runs** page
2. Expand input panel (if collapsed)
3. Scroll to the **Or Import JSON File** section
4. Click **Choose File** and select a previously downloaded JSON file
5. The table and JSON preview will display automatically (input panel collapses)
6. Use the tabs to switch between **Table View** and **JSON Preview**

### Filter and Sort Activity Runs

Once activity runs are loaded:

1. **Search**: Type in the "Search Activity Name" field to filter by activity name
2. **Filter by Status**: Select a status from the dropdown (All, Succeeded, Failed, InProgress, Queued)
3. **Sort**: Choose sorting option:
   - Start Time (Oldest First / Newest First)
   - Duration (Shortest First / Longest First)
4. **Clear Filters**: Click the "Clear Filters" button to reset all filters and search
5. **Virtual Scrolling**: Large datasets render efficiently with automatic virtualization

**Note:** 
- If date filters are not specified, the default is to query activity runs from the last month to now.
- The filtered count is displayed as "X of Y total" above the table.
- Virtual scrolling improves performance when viewing hundreds or thousands of activity runs.

##
- Microsoft.Fabric.Api (2.6.0)
- Azure.Identity (1.20.0)
- Bootstrap 5.3.0 (CDN)

## Project Structure

```
datntdev.Fabric.PipelineRunsViewer/
├── Components/
│   ├── Layout/
│   │   └── MainLayout.razor
│   ├── Pages/
│   │   ├── Home.razor
│   │   └── PipelineRuns.razor
│   ├── App.razor
│   └── Routes.razor
├── Models/
│   └── FabricApiSettings.cs
├── Services/
│   └── FabricApiService.cs
├── Program.cs
└── appsettings.json
```

## API Endpoint

The application calls the Microsoft Fabric REST API:
```
POST https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/datapipelines/pipelineruns/{pipelineRunId}/queryactivityruns
```

Request Body:
```json
{
  "orderBy": [{"orderBy": "ActivityRunStart", "order": "ASC"}],
  "lastUpdatedAfter": "2026-01-01T00:00:00.000Z",
  "lastUpdatedBefore": "2026-12-31T23:59:59.000Z",
  "continuationToken": ""
}
```

## Notes

- The application handles continuation tokens automatically to fetch all activity runs
- All activity run properties are preserved in the JSON output
- Error handling is included for API failures
