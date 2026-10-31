namespace NLog;

/// <summary>A stand-in for NLog's logger, so the fact samples resolve a known logger type without the package.</summary>
public sealed class Logger
{
    public void Info(string message) { }
    public void Warn(string message) { }
}
