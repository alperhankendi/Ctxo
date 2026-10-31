using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Lending.Facts;

/// <summary>FC-4b samples: business normalization next to calls that only look like it.</summary>
public static class MemberDirectory
{
    static readonly NLog.Logger Logger = new();
    static readonly AppLog logger = new();

    public static string Key(string email) => email.Trim().ToLowerInvariant();

    public static string Branch(string code) => code?.Trim().ToUpperInvariant();

    public static bool SameMember(string a, string b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    public static string Slug(string name) => $"{name.Trim()}-{name.Length}";

    public static string MemberId(Guid id) => "m*" + id.ToString("D").ToLowerInvariant();

    public static string Greeting(string guest) => $"Welcome back, {guest.Trim()}";

    public static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

    public static string FileKind(string file) => Path.GetExtension(file).ToLowerInvariant();

    public static string Folder(string root) => root.TrimEnd('/', '\\');

    public static char Initial(string name) => char.ToUpperInvariant(name[0]);

    public static void Refuse(string email)
    {
        Logger.Warn(email.ToLowerInvariant());
        throw new ArgumentException(email.ToUpperInvariant());
    }

    public static string Save(string email, string first, string last, Members members, Auth auth, TextWriter writer, StringBuilder sb, List<string> items)
    {
        Logger.Info(members.Upsert(email.ToUpperInvariant()));
        Logger.Warn("unknown " + first.TrimEnd());
        Logger.Warn(last.Trim().ToLowerInvariant());
        logger.Info(email.TrimEnd());
        auth.LogIn(email.TrimStart());
        writer.WriteLine(first.TrimStart());
        sb.AppendLine($"Dear {last.ToUpperInvariant()}");
        members.Query($"SELECT id FROM members WHERE email = '{email.ToLowerInvariant()}'");
        members.Lookup($"{first.Trim()} {last.TrimEnd()}");
        Logger.Info(string.Join(",", items.Select(i => i.Trim())));
        return members.Format(first.ToLowerInvariant());
    }
}

public sealed class Members
{
    public string Upsert(string email) => email;
    public void Query(string sql) { }
    public void Lookup(string key) { }
    public string Format(string text) => text;
}

/// <summary>A project logger: its type is no known logger, its receiver name makes it a sink in every tier.</summary>
public sealed class AppLog
{
    public void Info(string message) { }
}

public sealed class Auth
{
    public void LogIn(string email) { }
}
