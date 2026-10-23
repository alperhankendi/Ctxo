DELETE FROM dbo.Holds WHERE ExpiresAt < @now;
DELETE h
FROM dbo.Holds h
JOIN dbo.Members m ON m.Id = h.MemberId
