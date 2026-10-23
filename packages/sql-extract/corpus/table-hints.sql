SELECT *
FROM dbo.Loans WITH (NOLOCK)
JOIN dbo.Members (NOLOCK) ON Members.Id = Loans.MemberId
