# about

Takes a single Shape or a list of Shapes (from shape2d) and triangulates them using poly2tri. It attempts to sanitize input, removing collinear points, equal points, etc. since poly2tri tends to be very strict. It also allows for a basic list of steiner points to be included as the second parameter; they will be ignored if they are outside of the polygon's contour. 


# demo

See the demo folder, which uses [fontpath](https://github.com/mattdesl/fontpath) to decompose a Font glyph outline into a list of Shape objects, and then triangulates the result with user-submitted steiner points. 

To build the demo:

```
npm install browserify -g
npm run build
```