using Azure.Core;
using Azure.Identity;
using datntdev.Fabric.PipelineRunsViewer.Models;
using System.Net.Http.Headers;
using System.Text.Json;

namespace datntdev.Fabric.PipelineRunsViewer.Services
{
    public class FabricApiService
    {
        private readonly FabricApiSettings _settings;
        private readonly ILogger<FabricApiService> _logger;
        private readonly HttpClient _httpClient;
        private readonly ClientSecretCredential _credential;
        private const string FabricApiBaseUrl = "https://api.fabric.microsoft.com/v1";
        private const string Scope = "https://api.fabric.microsoft.com/.default";

        public FabricApiService(IConfiguration configuration, ILogger<FabricApiService> logger, HttpClient httpClient)
        {
            _settings = configuration.GetSection("FabricApi").Get<FabricApiSettings>() 
                ?? throw new InvalidOperationException("FabricApi settings are not configured");
            _logger = logger;
            _httpClient = httpClient;
            
            _credential = new ClientSecretCredential(
                _settings.TenantId,
                _settings.ClientId,
                _settings.ClientSecret);
        }

        private async Task<string> GetAccessTokenAsync()
        {
            var tokenRequestContext = new TokenRequestContext(new[] { Scope });
            var token = await _credential.GetTokenAsync(tokenRequestContext);
            return token.Token;
        }

        public async Task<List<object>> GetActivityRunsAsync(string workspaceId, string pipelineRunId, DateTime? lastUpdatedAfter = null, DateTime? lastUpdatedBefore = null)
        {
            try
            {
                var allActivityRuns = new List<object>();
                string? continuationToken = null;
                var accessToken = await GetAccessTokenAsync();

                // Default date range if not provided
                var dateAfter = lastUpdatedAfter ?? DateTime.UtcNow.AddMonths(-1);
                var dateBefore = lastUpdatedBefore ?? DateTime.UtcNow;

                do
                {
                    _logger.LogInformation($"Fetching activity runs for pipeline run ID: {pipelineRunId}, continuation token: {continuationToken}");

                    var url = $"{FabricApiBaseUrl}/workspaces/{workspaceId}/datapipelines/pipelineruns/{pipelineRunId}/queryactivityruns";
                    
                    // Build request body
                    var requestBody = new
                    {
                        orderBy = new[] { new { orderBy = "ActivityRunStart", order = "ASC" } },
                        lastUpdatedAfter = dateAfter.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                        lastUpdatedBefore = dateBefore.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                        continuationToken = continuationToken
                    };

                    var jsonContent = JsonSerializer.Serialize(requestBody);
                    var request = new HttpRequestMessage(HttpMethod.Post, url)
                    {
                        Content = new StringContent(jsonContent, System.Text.Encoding.UTF8, "application/json")
                    };
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

                    var response = await _httpClient.SendAsync(request);
                    response.EnsureSuccessStatusCode();

                    var content = await response.Content.ReadAsStringAsync();
                    var jsonDoc = JsonDocument.Parse(content);

                    if (jsonDoc.RootElement.TryGetProperty("value", out var valueElement))
                    {
                        foreach (var activityRun in valueElement.EnumerateArray())
                        {
                            // Parse each activity run and add to list
                            var activityRunDict = new Dictionary<string, object?>();
                            
                            foreach (var property in activityRun.EnumerateObject())
                            {
                                activityRunDict[property.Name] = property.Value.ValueKind switch
                                {
                                    JsonValueKind.String => property.Value.GetString(),
                                    JsonValueKind.Number => property.Value.GetDecimal(),
                                    JsonValueKind.True => true,
                                    JsonValueKind.False => false,
                                    JsonValueKind.Null => null,
                                    JsonValueKind.Object => JsonSerializer.Serialize(property.Value),
                                    JsonValueKind.Array => JsonSerializer.Serialize(property.Value),
                                    _ => property.Value.ToString()
                                };
                            }
                            
                            allActivityRuns.Add(activityRunDict);
                        }
                    }

                    // Check for continuation token
                    continuationToken = null;
                    if (jsonDoc.RootElement.TryGetProperty("continuationToken", out var tokenElement))
                    {
                        continuationToken = tokenElement.GetString();
                    }

                } while (!string.IsNullOrEmpty(continuationToken));

                _logger.LogInformation($"Total activity runs fetched: {allActivityRuns.Count}");
                return allActivityRuns;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, $"HTTP error fetching activity runs for pipeline run ID: {pipelineRunId}");
                throw new Exception($"Failed to fetch activity runs: {ex.Message}", ex);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching activity runs for pipeline run ID: {pipelineRunId}");
                throw;
            }
        }

        public string SerializeToJson(List<object> activityRuns)
        {
            return JsonSerializer.Serialize(activityRuns, new JsonSerializerOptions 
            { 
                WriteIndented = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });
        }
    }
}
