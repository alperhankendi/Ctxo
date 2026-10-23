SELECT *
FROM [dbo].[Ödünç Kaydı] AS o
JOIN Üye u ON u.Id = o.UyeId
JOIN KİTAP k ON k.Id = o.KitapId
