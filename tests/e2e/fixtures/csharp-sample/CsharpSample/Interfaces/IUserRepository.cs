using CsharpSample.Models;

namespace CsharpSample.Interfaces;

public interface IUserRepository
{
    User? FindById(int id);
    IEnumerable<User> GetAll();
    void Save(User user);
}
