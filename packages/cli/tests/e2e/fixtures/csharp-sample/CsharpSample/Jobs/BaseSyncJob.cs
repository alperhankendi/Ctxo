namespace CsharpSample.Jobs;

public abstract class BaseSyncJob
{
    public string JobName { get; }

    protected BaseSyncJob(string jobName)
    {
        JobName = jobName;
    }

    public abstract Task ExecuteAsync();

    protected void LogStart()
    {
        Console.WriteLine($"[{JobName}] Starting...");
    }

    protected void LogComplete()
    {
        Console.WriteLine($"[{JobName}] Complete.");
    }
}
