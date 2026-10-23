SELECT l.Id, m.Name, b.Title
FROM dbo.Loans l, dbo.Members AS m, dbo.Books b
WHERE m.Id = l.MemberId AND b.Id = l.BookId
ORDER BY l.Id, m.Name
