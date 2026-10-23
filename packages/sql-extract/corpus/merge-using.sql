MERGE dbo.Members AS t
USING dbo.MemberStaging AS s
ON t.Id = s.Id
WHEN MATCHED THEN
    UPDATE SET t.Name = s.Name
WHEN NOT MATCHED THEN
    INSERT (Id, Name) VALUES (s.Id, s.Name);
