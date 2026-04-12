using CsharpSample.Models;
using CsharpSample.Interfaces;

namespace CsharpSample.Services;

public class UserService : IUserRepository
{
    private readonly List<User> _users = new();

    public User? FindById(int id)
    {
        return _users.FirstOrDefault(u => u.Id == id);
    }

    public IEnumerable<User> GetAll()
    {
        return _users.AsReadOnly();
    }

    public void Save(User user)
    {
        _users.Add(user);
    }

    public string GetUserDisplay(int id)
    {
        var user = FindById(id);
        if (user == null)
            return "Unknown";
        return user.GetDisplayName();
    }
}
