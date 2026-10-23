SELECT l.Id
FROM ((dbo.Loans AS l
    INNER JOIN dbo.Members AS m ON m.Id = l.MemberId)
    INNER JOIN dbo.Books AS b ON b.Id = l.BookId);
UPDATE l
SET l.Flagged = 1
FROM ((dbo.Loans AS l
    JOIN dbo.Holds AS h ON h.LoanId = l.Id)
    JOIN dbo.Members AS m ON m.Id = l.MemberId)
WHERE m.Blocked = 1
