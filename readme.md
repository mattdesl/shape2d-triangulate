# about

Takes a single Shape or a list of Shapes (from shape2d) and triangulates them using poly2tri. It attempts to sanitize input, removing collinear points, equal points, etc so that it works with poly2tri. It also allows for a basic list of steiner points to be included as the second parameter; they will be ignored if they are outside of the polygon's contour. 

If winding orders differ from the first specified Shape, they are assumed to be holes. Otherwise, subsequent Shape objects are assumed to be a completely new shape that need their own triangulation and sweep context.

# example

```
var tesselate = require('shape2d-triangulate');
var triangleList = tesselate( myShape );
```

# demo

[![Result](http://i.imgur.com/vwJec5B.png)](http://mattdesl.github.io/shape2d-triangulate/demo/glyph.html)

See the demo folder, which uses [fontpath](https://github.com/mattdesl/fontpath) to decompose an OpenBaskerville glyph outline into a list of Shape objects, and then triangulates the result with user-submitted steiner points.  

You can run the demo [here](http://mattdesl.github.io/shape2d-triangulate/demo/glyph.html).

To build the demos:

```
npm install browserify -g
npm run build
```