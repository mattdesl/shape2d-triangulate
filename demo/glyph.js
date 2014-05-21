var Matrix3 = require('vecmath').Matrix3;
var Vector2 = require('vecmath').Vector2;

var test = require('canvas-testbed');

//For best precision, export with the same font 
//size that we're planning on rendering it at..
var TestFont = require('fontpath-test-fonts/lib/OpenBaskerville-0.0.75.ttf');

var toGlyphMatrix3 = require('fontpath-vecmath').toGlyphMatrix3;
var decompose = require('fontpath-shape2d');
var triangulate = require('../index');

var glyph = TestFont.glyphs["8"];
var tmpMat = new Matrix3();
var mouse = new Vector2();

var shapes;

function loadShapes() {
	shapes = decompose(glyph);

	//We can optionally simplify the path like so.
	//Remember, they are in font units (EM)
	for (var i=0; i<shapes.length; i++) {
		shapes[i].simplify( TestFont.size * 2, shapes[i] );
	}
}


//This is optional, but leads to more inner triangles for boxy letters like 'T'
//Scatter the EM square with steiner points.
//These will get removed by triangulation if they are deemed to
//be inside a hole or within the glyph's contour.
var steinerPoints = [];

function addRandomSteinerPoints(N) {
	N = N||200;
	for (var count=0; count<N; count++) {
		var dat = { 
			x: Math.round(Math.random()*(glyph.width+glyph.hbx)), 
			y: -glyph.hby + Math.round(Math.random()*(glyph.height+glyph.hby)) 
		};
		steinerPoints.push(dat);
	}
}

var tris;

loadShapes(glyph);
retriangulate();

function reset() {
	steinerPoints.length = 0;
	retriangulate();
}

function retriangulate() {
	tris = triangulate(shapes, steinerPoints);
}

//Setup a simple glyph matrix to scale from EM to screen pixels...
var glyphMatrix = toGlyphMatrix3(TestFont, glyph, 200, 20, 300);

function render(context, width, height) {
	context.clearRect(0, 0, width, height);
	context.save();

	//Here's an example of using the matrix directly. 
	//Usually we would just transform a Vector2 by the matrix (like in shapes.js)
	var val = glyphMatrix.val;
	var scale = val[0],
		xoff = val[6],
		yoff = val[7];

	context.setTransform(scale, 0, 0, -scale, xoff, yoff);

	//fix the line width now that we've scaled down
	context.lineWidth = 1/scale * 0.75; 

	context.fillStyle = 'black'
	context.beginPath();
	for (var i=0; i<tris.length; i++) {
		var t = tris[i].getPoints();
		context.moveTo(t[0].x, t[0].y);
		context.lineTo(t[1].x, t[1].y);
		context.lineTo(t[2].x, t[2].y);
		context.lineTo(t[0].x, t[0].y);
	}
	context.stroke();
	context.restore();	

	context.fillStyle = 'red'
	context.fillRect(mouse.x-5, mouse.y-5, 10, 10);
}

window.addEventListener('mousemove', function(ev) {
	mouse.set(ev.clientX, ev.clientY);
});

window.addEventListener('mousedown', function(ev) {
	tmpMat.copy(glyphMatrix).invert();
	steinerPoints.push( mouse.clone().transformMat3(tmpMat) );
	retriangulate();
});

window.addEventListener('keydown', function(ev) {
	var code = (ev.which||ev.keyCode);
	var chr = String.fromCharCode(code).toLowerCase();

	if (code === 32)
		reset();
	else if (chr === 'r') {
		addRandomSteinerPoints();
		retriangulate();
	} else if (chr && chr in TestFont.glyphs) {
		if (ev.shiftKey)
			chr = chr.toUpperCase();
		glyph = TestFont.glyphs[chr];
		loadShapes();
		reset();
	}
});

function start() { //called on domready
	var div = document.createElement("div");
	div.innerHTML = "<div>click to add steiner points</div><div>R to add random points</div><div>SPACE to reset</div>"
			+ "<div>press any other key to see it</div>";
	div.style.position = "absolute";
	div.style.top = "20px";
	div.style.margin = "0";
	div.style.left = "200px";
	document.body.appendChild(div);
}

//render a single frame to the canvas testbed
test(render, start);