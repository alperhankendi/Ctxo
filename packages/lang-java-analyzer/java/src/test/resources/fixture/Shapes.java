package fixture;

import java.util.List;

public class Shapes {
  public Shapes() {}
  enum Kind { CIRCLE, SQUARE }
  record Point(int x, int y) {}
  @interface Tag {}
  private List<Bar> bars;
}
