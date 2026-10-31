namespace LibraryLending.Lending;

public static class MemberDirectory
{
    public static string Key(string email)
    {
        var trimmed = email.Trim();
        return trimmed.ToLowerInvariant();
    }
}
