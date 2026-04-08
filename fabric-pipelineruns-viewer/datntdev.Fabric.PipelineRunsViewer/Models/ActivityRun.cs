using System.Text.Json.Serialization;

namespace datntdev.Fabric.PipelineRunsViewer.Models
{
    public class ActivityRun
    {
        [JsonPropertyName("pipelineId")]
        public string? PipelineId { get; set; }

        [JsonPropertyName("pipelineName")]
        public string? PipelineName { get; set; }

        [JsonPropertyName("pipelineRunId")]
        public string? PipelineRunId { get; set; }

        [JsonPropertyName("activityName")]
        public string? ActivityName { get; set; }

        [JsonPropertyName("activityType")]
        public string? ActivityType { get; set; }

        [JsonPropertyName("activityRunId")]
        public string? ActivityRunId { get; set; }

        [JsonPropertyName("status")]
        public string? Status { get; set; }

        [JsonPropertyName("activityRunStart")]
        public DateTime? ActivityRunStart { get; set; }

        [JsonPropertyName("activityRunEnd")]
        public DateTime? ActivityRunEnd { get; set; }

        [JsonPropertyName("durationInMs")]
        public long? DurationInMs { get; set; }

        [JsonPropertyName("input")]
        public object? Input { get; set; }

        [JsonPropertyName("output")]
        public object? Output { get; set; }

        [JsonPropertyName("error")]
        public object? Error { get; set; }

        [JsonPropertyName("iterationHash")]
        public string? IterationHash { get; set; }

        [JsonPropertyName("userProperties")]
        public object? UserProperties { get; set; }

        [JsonPropertyName("retryAttempt")]
        public int? RetryAttempt { get; set; }

        [JsonPropertyName("recoveryStatus")]
        public string? RecoveryStatus { get; set; }

        [JsonPropertyName("integrationRuntimeNames")]
        public object? IntegrationRuntimeNames { get; set; }

        [JsonPropertyName("executionDetails")]
        public object? ExecutionDetails { get; set; }

        public string GetFormattedDuration()
        {
            if (!DurationInMs.HasValue) return "N/A";
            
            var ts = TimeSpan.FromMilliseconds(DurationInMs.Value);
            if (ts.TotalHours >= 1)
                return $"{ts.Hours}h {ts.Minutes}m {ts.Seconds}s";
            else if (ts.TotalMinutes >= 1)
                return $"{ts.Minutes}m {ts.Seconds}s";
            else
                return $"{ts.Seconds}s {ts.Milliseconds}ms";
        }

        public string GetStatusClass()
        {
            return Status?.ToLower() switch
            {
                "succeeded" => "text-success",
                "failed" => "text-danger",
                "inprogress" => "text-primary",
                "queued" => "text-warning",
                _ => "text-secondary"
            };
        }

        public string GetStatusIcon()
        {
            return Status?.ToLower() switch
            {
                "succeeded" => "✓",
                "failed" => "✗",
                "inprogress" => "⟳",
                "queued" => "⏸",
                _ => "•"
            };
        }
    }
}
