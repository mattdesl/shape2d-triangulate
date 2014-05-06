(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Matrix3 = require('vecmath').Matrix3;
var Vector2 = require('vecmath').Vector2;

var test = require('canvas-testbed');

//For best precision, export with the same font 
//size that we're planning on rendering it at..
var TestFont = require('fontpath-test-fonts/lib/OpenBaskerville-0.0.53.ttf');

var toGlyphMatrix3 = require('fontpath-vecmath').toGlyphMatrix3;
var decompose = require('fontpath-shape2d');
var triangulate = require('../index');

var glyph = TestFont.glyphs["8"];
var tmpVec = new Vector2();
var tmpMat = new Matrix3();
var mouse = new Vector2();

var shapes = decompose(glyph);

//We can optionally simplify the path like so.
//Remember, they are in font units (EM)
for (var i=0; i<shapes.length; i++) {
	shapes[i].simplify( TestFont.size * 2, shapes[i] );
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
			y: Math.round(Math.random()*glyph.height) 
		};
		steinerPoints.push(dat);
	}
}

var tris;
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
	if (code === 32)
		reset();
	else if (String.fromCharCode(code).toLowerCase() === 'r') {
		addRandomSteinerPoints();
		retriangulate();
	}
});

function start() { //domready
	var div = document.createElement("div");
	div.innerHTML = "<div>click to add steiner points</div><div>R to add random points</div><div>SPACE to reset</div>";
	div.style.position = "absolute";
	div.style.top = "20px";
	div.style.margin = "0";
	div.style.left = "200px";
	document.body.appendChild(div);
}

//render a single frame to the canvas testbed
test(render, start);
},{"../index":2,"canvas-testbed":3,"fontpath-shape2d":6,"fontpath-test-fonts/lib/OpenBaskerville-0.0.53.ttf":10,"fontpath-vecmath":11,"vecmath":32}],2:[function(require,module,exports){
var poly2tri = require('poly2tri');
var util = require('point-util');

function asPointSet(points) {
    var contour = [];

    for (var n=0; n<points.length; n++) {
        var x = points[n].x;
        var y = points[n].y;
                
        var np = new poly2tri.Point(x, y);
        
        if (util.indexOfPointInList(np, contour) === -1) {
            if ( (n===0 || n===points.length-1) || !util.isCollinear(points[n-1], points[n], points[n+1]))
                contour.push(np);
        }
    }
    return contour;
}

function insideHole(poly, point) {
    for (var i=0; i<poly.holes.length; i++) {
        var hole = poly.holes[i];
        if (util.pointInPoly(hole, point))
            return true;
    }
    return false;
}

function addSteinerPoints(poly, points, sweep) {
    var bounds = util.getBounds(poly.contour);

    //ensure points are unique and not collinear 
    points = asPointSet(points);

    for (var i=0; i<points.length; i++) {
        var p = points[i];

        //fugly collinear fix ... gotta revisit this
        p.x += 0.5;
        p.y += 0.5;

        if (p.x <= bounds.minX || p.y <= bounds.minY || p.x >= bounds.maxX || p.y >= bounds.maxY)
            continue;

        if (util.pointInPoly(poly.contour, p) && !insideHole(poly, p)) {
            //We are in the polygon! Now make sure we're not in a hole..
            sweep.addPoint(new poly2tri.Point(p.x, p.y));
        }
    }
}

/**
 * Triangulates a list of Shape objects. 
 */
module.exports = function (shapes, steinerPoints) {
    var windingClockwise = false;
    var sweep = null;

    var poly = {holes:[], contour:[]};
    var allTris = [];

    shapes = Array.isArray(shapes) ? shapes : [ shapes ];

    steinerPoints = (steinerPoints && steinerPoints.length !== 0) ? steinerPoints : null;

    for (var j=0; j<shapes.length; j++) {
        var points = shapes[j].points;
        
        var set = asPointSet(points);

        //check the winding order
        if (j==0) {
            windingClockwise = util.isClockwise(set);
        }
        
        //if the sweep has already been created, maybe we're on a hole?
        if (sweep !== null) {
            var clock = util.isClockwise(set);

            //we have a hole...
            if (windingClockwise !== clock) {
                sweep.addHole( set );
                poly.holes.push(set);
            } else {
                //no hole, so it must be a new shape.
                //add our last shape
                if (steinerPoints!==null) {
                    addSteinerPoints(poly, steinerPoints, sweep);
                }

                sweep.triangulate();
                allTris = allTris.concat(sweep.getTriangles());

                //reset the sweep for next shape
                sweep = new poly2tri.SweepContext(set);
                poly = {holes:[], contour:points};
            }
        } else {
            sweep = new poly2tri.SweepContext(set);   
            poly = {holes:[], contour:points};
        }
    }

    //if the sweep is still setup, then triangulate it
    if (sweep !== null) {
        if (steinerPoints!==null) {
            addSteinerPoints(poly, steinerPoints, sweep);
        }

        sweep.triangulate();
        allTris = allTris.concat(sweep.getTriangles());
    }
    return allTris;
};
},{"point-util":13,"poly2tri":19}],3:[function(require,module,exports){
var domready = require('domready');
require('raf.js');

module.exports = function( render, start, options ) {
	domready(function() {
		options = options||{};

		document.body.style.margin = "0";
		document.body.style.overflow = "hidden";

		var canvas = document.createElement("canvas");
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		canvas.setAttribute("id", "canvas");

		document.body.appendChild(canvas);

		var context,
			attribs = options.contextAttributes||{};
		if (options.context === "webgl" || options.context === "experimental-webgl") {
			try {
				context = (canvas.getContext('webgl', attribs) 
							|| canvas.getContext('experimental-webgl', attribs));
			} catch (e) {
				context = null;
			}
			if (!context) {
				throw "WebGL Context Not Supported -- try enabling it or using a different browser";
			}	
		} else {
			context = canvas.getContext(options.context||"2d", attribs);
		}

		var width = canvas.width,
			height = canvas.height;

		window.addEventListener("resize", function() {
			width = window.innerWidth;
			height = window.innerHeight;
			canvas.width = width;
			canvas.height = height;
		});

		
		var then = Date.now();

		if (typeof start === "function") {
			start(context, width, height);
		}

		if (typeof render === "function") {
			function renderHandler() {
				var now = Date.now();
				var dt = (now-then);

				if (!options.once)
					requestAnimationFrame(renderHandler);
				
				render(context, width, height, dt);
				then = now;
			}
			requestAnimationFrame(renderHandler);
		}			
	});
}
},{"domready":4,"raf.js":5}],4:[function(require,module,exports){
/*!
  * domready (c) Dustin Diaz 2014 - License MIT
  */
!function (name, definition) {

  if (typeof module != 'undefined') module.exports = definition()
  else if (typeof define == 'function' && typeof define.amd == 'object') define(definition)
  else this[name] = definition()

}('domready', function () {

  var fns = [], listener
    , doc = document
    , domContentLoaded = 'DOMContentLoaded'
    , loaded = /^loaded|^i|^c/.test(doc.readyState)

  if (!loaded)
  doc.addEventListener(domContentLoaded, listener = function () {
    doc.removeEventListener(domContentLoaded, listener)
    loaded = 1
    while (listener = fns.shift()) listener()
  })

  return function (fn) {
    loaded ? fn() : fns.push(fn)
  }

});

},{}],5:[function(require,module,exports){
/*
 * raf.js
 * https://github.com/ngryman/raf.js
 *
 * original requestAnimationFrame polyfill by Erik Möller
 * inspired from paul_irish gist and post
 *
 * Copyright (c) 2013 ngryman
 * Licensed under the MIT license.
 */

(function(window) {
	var lastTime = 0,
		vendors = ['webkit', 'moz'],
		requestAnimationFrame = window.requestAnimationFrame,
		cancelAnimationFrame = window.cancelAnimationFrame,
		i = vendors.length;

	// try to un-prefix existing raf
	while (--i >= 0 && !requestAnimationFrame) {
		requestAnimationFrame = window[vendors[i] + 'RequestAnimationFrame'];
		cancelAnimationFrame = window[vendors[i] + 'CancelAnimationFrame'];
	}

	// polyfill with setTimeout fallback
	// heavily inspired from @darius gist mod: https://gist.github.com/paulirish/1579671#comment-837945
	if (!requestAnimationFrame || !cancelAnimationFrame) {
		requestAnimationFrame = function(callback) {
			var now = +new Date(), nextTime = Math.max(lastTime + 16, now);
			return setTimeout(function() {
				callback(lastTime = nextTime);
			}, nextTime - now);
		};

		cancelAnimationFrame = clearTimeout;
	}

	// export to window
	window.requestAnimationFrame = requestAnimationFrame;
	window.cancelAnimationFrame = cancelAnimationFrame;
}(window));

},{}],6:[function(require,module,exports){
var Shape = require('shape2d');

var funcs = {
    'm': 'moveTo',
    'l': 'lineTo',
    'q': 'quadraticCurveTo',
    'c': 'bezierCurveTo'
};

/**
 * Decomposes a glyph and its outline from fontpath into a list of Shapes from shape2d.
 * This is a discrete set of points that can then be used for triangulation
 * or further effects.
 */
module.exports = function(glyph, options) {
    options = options||{};

    var curves = Boolean(options.approximateCurves);
    var steps = options.steps||10;
    var factor = options.approximationFactor;
    factor = (typeof factor==="number") ? factor : 0.5;

    var shapes = [];
    var shape = new Shape();
    shape.approximateCurves = curves;
    shape.approximationFactor = factor;
    shape.steps = steps;

    if (!glyph.path || glyph.path.length===0)
        return shapes;

    var path = glyph.path;
    for (var i=0; i<path.length; i++) {
        var p = path[i];
        var args = p.slice(1);
        var fkey = funcs[ p[0] ];

        //assume we are on a new shape when we reach a moveto
        //will have to revisit this with a better solution 
        //maybe even-odd rule
        if (i!==0 && fkey==='moveTo') {
            //push the current shape ahead..
            shapes.push(shape);

            shape = new Shape();
            shape.approximateCurves = curves;
            shape.approximationFactor = factor;
            shape.steps = steps;
        }

        shape[fkey].apply(shape, args);
    }

    shapes.push(shape);
    return shapes;
}
},{"shape2d":7}],7:[function(require,module,exports){
var Vector2 = require('vecmath').Vector2;
var Class = require('klasse');
var lerp = require('interpolation').lerp;

function distanceTo(x1, y1, x2, y2) {
    var dx = x2-x1;
    var dy = y2-y1;
    return Math.sqrt(dx*dx+dy*dy);
}

var tmp1 = new Vector2();
var tmp2 = new Vector2();

var Shape = new Class({

    initialize: function() {
        this.steps = 1;
        this.points = [];

        // If step is not provided to a ***CurveTo function, 
        // then it will be approximated with a very simple distance check
        this.approximateCurves = true;
        this.approximationFactor = 0.5;

        this._move = new Vector2();
        this._start = new Vector2();
        this._hasMoved = false;
        this._newPath = true;
    },


    reset: function() {
        this.points.length = 0;
        this._newPath = true;
        this._hasMoved = false;
        this._move.x = this._move.y = 0;
        this._start.x = this._start.y = 0;
    },

    beginPath: function() {
        this.reset();
    },
    
    moveTo: function(x, y) {
        this._newPath = true;
        this._move.x = x;
        this._move.y = y;
        this._start.x = x;
        this._start.y = y;
        this._hasMoved = true;
    },

    __newPoint: function(nx, ny) {
        this.points.push(new Vector2(nx, ny));
        this._newPath = false;
    },
    
    /** Closes the path by performing a lineTo with the first 'starting' point. 
        If the path is empty, this does nothing. */
    closePath: function(steps) {
        if (this.points.length===0)
            return;
        this.lineTo(this._start.x, this._start.y, steps);
    },
    
    lineTo: function(x, y, steps) {
        //if we are calling lineTo before any moveTo.. make this the first point
        if (!this._hasMoved) {
            this.moveTo(x, y);
            return;
        }

        steps = Math.max(1, steps || this.steps);
        for (var i=0; i<=steps; i++) { 
            if (!this._newPath && i==0)
                continue;
                
            var t = i/steps;   
            var nx = lerp(this._move.x, x, t);
            var ny = lerp(this._move.y, y, t);
            
            this.__newPoint(nx, ny);
        }
        this._move.x = x;
        this._move.y = y; 
    },

    /** Creates a bezier (cubic) curve to the specified point, with the given control points.
    If steps is not specified or is a falsy value, this function will use the default value
    set for this Path object. It will be capped to a minimum of 3 steps. 
    */
    bezierCurveTo: function(x2, y2, x3, y3, x4, y4, steps) {
        //if we are calling lineTo before any moveTo.. make this the first point
        if (!this._hasMoved) {
            this.moveTo(x, y);
            return;
        }
        
        var x1 = this._move.x;
        var y1 = this._move.y;
        
        //try to approximate with a simple distance sum.
        //more accurate would be to use this:
        //http://antigrain.com/research/adaptive_bezier/
        if (!steps) {
            if (this.approximateCurves) {
                var d1 = distanceTo(x1, y1, x2, y2);
                var d2 = distanceTo(x2, y2, x3, y3);
                var d3 = distanceTo(x3, y3, x4, y4);
                steps = ~~((d1 + d2 + d3) * this.approximationFactor);
            } else {
                steps = Math.max(1, this.steps);
            }
        } 
        
        for (var i=0; i<steps; i++) {
            var t = i / (steps-1);
            var dt = (1 - t);
            
            var dt2 = dt * dt;
            var dt3 = dt2 * dt;
            var t2 = t * t;
            var t3 = t2 * t;
            
            var x = dt3 * x1 + 3 * dt2 * t * x2 + 3 * dt * t2 * x3 + t3 * x4;
            var y = dt3 * y1 + 3 * dt2 * t * y2 + 3 * dt * t2 * y3 + t3 * y4;
            
            this.__newPoint(x, y);
        }
        
        this._move.x = x4;
        this._move.y = y4;
    },
    
    /** Creates a quadratic curve to the specified point, with the given control points.
    If steps is not specified or is a falsy value, this function will use the default value
    set for this Path object. It will be capped to a minimum of 3 steps. 
    */
    quadraticCurveTo: function(x2, y2, x3, y3, steps) {
        //if we are calling lineTo before any moveTo.. make this the first point
        if (!this._hasMoved) {
            this.moveTo(x, y);
            return;
        } 
        
        var x1 = this._move.x;
        var y1 = this._move.y;
        
        //try to approximate with a simple distance sum.
        //more accurate would be to use this:
        //http://antigrain.com/research/adaptive_bezier/
        if (!steps) {
            if (this.approximateCurves) {
                var d1 = tmp1.set(x1, y1).distance( tmp2.set(x2, y2) );
                var d2 = tmp1.set(x2, y2).distance( tmp2.set(x3, y3) );
                steps = ~~((d1 + d2) * this.approximationFactor);
            } else {
                steps = Math.max(1, this.steps);
            }
        } 
        
        for (var i=0; i<steps; i++) {
            var t = i / (steps-1);
            var dt = (1 - t);
            var dtSq = dt * dt;
            var tSq = t * t;
            
            var x = dtSq * x1 + 2 * dt * t * x2 + tSq * x3;
            var y = dtSq * y1 + 2 * dt * t * y2 + tSq * y3;
            
            this.__newPoint(x, y);
        }
        
        this._move.x = x3;
        this._move.y = y3;
    },

    calculateBoundingBox: function() {
        var points = this.points;

        var minX = Number.MAX_VALUE,
            minY = Number.MAX_VALUE,
            maxX = -Number.MAX_VALUE,
            maxY = -Number.MAX_VALUE;

        for (var i=0; i<points.length; i++) {
            var p = points[i];

            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        return {
            x: minX,
            y: minY,
            width: maxX-minX,
            height: maxY-minY
        };
    },

    contains: function(x, y) {
        var testx = x, testy = y;
        if (typeof x === "object") {
            testx = x.x;
            testy = x.y;
        }

        var points = this.points;
        var nvert = points.length;
        var i, j, c = 0;
        for (i=0, j=nvert-1; i<nvert; j=i++) {
            if ( ((points[i].y>testy) != (points[j].y>testy)) &&
                (testx < (points[j].x-points[i].x) * (testy-points[i].y) / (points[j].y-points[i].y) + points[i].x) ) {
                c = !c;
            }
        }
        return c;
    },


    simplify: function(tolerance, out) {
        var points = this.points,
            len = points.length,
            point = new Vector2(),
            sqTolerance = tolerance*tolerance,
            prevPoint = new Vector2( points[0] );

        if (!out)
            out = new Shape();

        var outPoints = [];
        outPoints.push(prevPoint);

        for (var i=1; i<len; i++) {
            point = points[i];
            if ( point.distanceSq(prevPoint) > sqTolerance ) {
                outPoints.push(new Vector2(point));
                prevPoint = point;
            }
        }
        if (prevPoint.x !== point.x || prevPoint.y !== point.y)
            outPoints.push(new Vector2(point));

        out.points = outPoints;
        return out; 
    }
});

module.exports = Shape;
},{"interpolation":8,"klasse":9,"vecmath":32}],8:[function(require,module,exports){
/** Utility function for linear interpolation. */
module.exports.lerp = function(v0, v1, t) {
    return v0*(1-t)+v1*t;
};

/** Utility function for Hermite interpolation. */
module.exports.smoothstep = function(v0, v1, t) {
    // Scale, bias and saturate x to 0..1 range
    t = Math.max(0.0, Math.min(1.0, (t - v0)/(v1 - v0) ));
    // Evaluate polynomial
    return t*t*(3 - 2*t);
};
},{}],9:[function(require,module,exports){
function hasGetterOrSetter(def) {
	return (!!def.get && typeof def.get === "function") || (!!def.set && typeof def.set === "function");
}

function getProperty(definition, k, isClassDescriptor) {
	//This may be a lightweight object, OR it might be a property
	//that was defined previously.
	
	//For simple class descriptors we can just assume its NOT previously defined.
	var def = isClassDescriptor 
				? definition[k] 
				: Object.getOwnPropertyDescriptor(definition, k);

	if (!isClassDescriptor && def.value && typeof def.value === "object") {
		def = def.value;
	}


	//This might be a regular property, or it may be a getter/setter the user defined in a class.
	if ( def && hasGetterOrSetter(def) ) {
		if (typeof def.enumerable === "undefined")
			def.enumerable = true;
		if (typeof def.configurable === "undefined")
			def.configurable = true;
		return def;
	} else {
		return false;
	}
}

function hasNonConfigurable(obj, k) {
	var prop = Object.getOwnPropertyDescriptor(obj, k);
	if (!prop)
		return false;

	if (prop.value && typeof prop.value === "object")
		prop = prop.value;

	if (prop.configurable === false) 
		return true;

	return false;
}

//TODO: On create, 
//		On mixin, 

function extend(ctor, definition, isClassDescriptor, extend) {
	for (var k in definition) {
		if (!definition.hasOwnProperty(k))
			continue;

		var def = getProperty(definition, k, isClassDescriptor);

		if (def !== false) {
			//If Extends is used, we will check its prototype to see if 
			//the final variable exists.
			
			var parent = extend || ctor;
			if (hasNonConfigurable(parent.prototype, k)) {

				//just skip the final property
				if (Class.ignoreFinals)
					continue;

				//We cannot re-define a property that is configurable=false.
				//So we will consider them final and throw an error. This is by
				//default so it is clear to the developer what is happening.
				//You can set ignoreFinals to true if you need to extend a class
				//which has configurable=false; it will simply not re-define final properties.
				throw new Error("cannot override final property '"+k
							+"', set Class.ignoreFinals = true to skip");
			}

			Object.defineProperty(ctor.prototype, k, def);
		} else {
			ctor.prototype[k] = definition[k];
		}

	}
}

/**
 */
function mixin(myClass, mixins) {
	if (!mixins)
		return;

	if (!Array.isArray(mixins))
		mixins = [mixins];

	for (var i=0; i<mixins.length; i++) {
		extend(myClass, mixins[i].prototype || mixins[i]);
	}
}

/**
 * Creates a new class with the given descriptor.
 * The constructor, defined by the name `initialize`,
 * is an optional function. If unspecified, an anonymous
 * function will be used which calls the parent class (if
 * one exists). 
 *
 * You can also use `Extends` and `Mixins` to provide subclassing
 * and inheritance.
 *
 * @class  Class
 * @constructor
 * @param {Object} definition a dictionary of functions for the class
 * @example
 *
 * 		var MyClass = new Class({
 * 		
 * 			initialize: function() {
 * 				this.foo = 2.0;
 * 			},
 *
 * 			bar: function() {
 * 				return this.foo + 5;
 * 			}
 * 		});
 */
function Class(definition) {
	if (!definition)
		definition = {};

	//The variable name here dictates what we see in Chrome debugger
	var initialize;
	var Extends;

	if (definition.initialize) {
		if (typeof definition.initialize !== "function")
			throw new Error("initialize must be a function");
		initialize = definition.initialize;

		//Usually we should avoid "delete" in V8 at all costs.
		//However, its unlikely to make any performance difference
		//here since we only call this on class creation (i.e. not object creation).
		delete definition.initialize;
	} else {
		if (definition.Extends) {
			var base = definition.Extends;
			initialize = function () {
				base.apply(this, arguments);
			}; 
		} else {
			initialize = function () {}; 
		}
	}

	if (definition.Extends) {
		initialize.prototype = Object.create(definition.Extends.prototype);
		initialize.prototype.constructor = initialize;
		//for getOwnPropertyDescriptor to work, we need to act
		//directly on the Extends (or Mixin)
		Extends = definition.Extends;
		delete definition.Extends;
	} else {
		initialize.prototype.constructor = initialize;
	}

	//Grab the mixins, if they are specified...
	var mixins = null;
	if (definition.Mixins) {
		mixins = definition.Mixins;
		delete definition.Mixins;
	}

	//First, mixin if we can.
	mixin(initialize, mixins);

	//Now we grab the actual definition which defines the overrides.
	extend(initialize, definition, true, Extends);

	return initialize;
};

Class.extend = extend;
Class.mixin = mixin;
Class.ignoreFinals = false;

module.exports = Class;
},{}],10:[function(require,module,exports){
module.exports = {"size":64,"resolution":72,"underline_thickness":0,"underline_position":0,"max_advance_width":1096,"height":1120,"descender":-204,"ascender":916,"units_per_EM":1000,"style_name":"Normal","family_name":"Open Baskerville 0.0.53","kerning":[],"glyphs":{"0":{"xoff":2048,"width":1856,"height":2944,"hbx":128,"hby":2880,"path":[["m",1482,2636],["q",1270,2880,1028,2880],["q",787,2880,574,2636],["q",362,2392,245,2053],["q",128,1714,128,1402],["q",128,757,412,375],["q",696,-7,1028,-7],["q",1360,-7,1644,375],["q",1928,757,1928,1402],["q",1928,1714,1811,2053],["q",1695,2392,1482,2636],["m",1441,441],["q",1282,59,1028,59],["q",774,59,615,441],["q",456,824,456,1404],["q",456,1993,615,2403],["q",774,2814,1028,2814],["q",1282,2814,1441,2403],["q",1600,1993,1600,1404],["q",1600,824,1441,441]]},"1":{"xoff":1344,"width":1344,"height":2816,"hbx":0,"hby":2816,"path":[["m",840,2789],["l",776,2789],["q",721,2728,648,2686],["q",576,2645,484,2624],["q",393,2603,335,2592],["q",277,2581,185,2573],["q",94,2565,90,2565],["l",90,2518],["q",180,2501,299,2501],["l",512,2524],["l",512,564],["q",512,293,409,182],["q",307,71,61,71],["l",61,5],["l",1315,5],["l",1315,71],["q",1073,71,956,179],["q",840,287,840,563],["l",840,2789]]},"2":{"xoff":2112,"width":1856,"height":2816,"hbx":128,"hby":2880,"path":[["m",128,64],["l",1758,64],["l",1924,754],["l",1896,754],["q",1891,738,1881,707],["q",1871,677,1833,603],["q",1795,529,1745,471],["q",1696,414,1606,367],["q",1517,320,1413,320],["l",473,320],["l",606,419],["q",735,522,860,621],["q",985,720,1155,866],["q",1325,1012,1438,1124],["q",1666,1351,1793,1629],["q",1920,1907,1920,2101],["q",1920,2204,1885,2322],["q",1850,2440,1767,2573],["q",1684,2707,1502,2793],["q",1320,2880,1067,2880],["q",847,2880,682,2811],["q",517,2743,430,2629],["q",343,2515,299,2397],["q",256,2279,256,2154],["q",256,1913,404,1761],["q",553,1610,729,1610],["q",948,1610,1026,1728],["q",888,1728,769,1767],["q",650,1806,549,1933],["q",448,2061,448,2263],["q",448,2415,509,2530],["q",570,2645,662,2703],["q",754,2761,842,2787],["q",930,2814,1006,2814],["q",1090,2814,1175,2791],["q",1261,2769,1364,2710],["q",1467,2651,1529,2520],["q",1592,2390,1592,2202],["q",1592,1666,871,829],["q",753,695,568,513],["q",384,331,254,217],["l",128,102],["l",128,64]]},"3":{"xoff":2048,"width":1792,"height":2944,"hbx":128,"hby":2880,"path":[["m",847,2110],["q",803,2065,667,2065],["q",505,2065,412,2166],["q",320,2267,320,2388],["q",320,2574,510,2727],["q",701,2880,1024,2880],["q",1251,2880,1422,2805],["q",1594,2731,1682,2614],["q",1770,2498,1813,2386],["q",1856,2274,1856,2178],["q",1856,1929,1701,1756],["q",1546,1583,1274,1521],["q",1864,1322,1864,818],["q",1864,461,1617,227],["q",1370,-7,911,-7],["q",822,-7,716,11],["q",611,30,465,82],["q",319,135,223,262],["q",128,389,128,576],["q",128,752,234,870],["q",340,989,504,989],["q",528,989,584,981],["q",384,835,384,576],["q",384,343,514,201],["q",645,59,904,59],["q",1196,59,1366,268],["q",1536,477,1536,797],["q",1536,1088,1402,1276],["q",1268,1465,1112,1465],["q",1032,1465,940,1404],["q",848,1344,787,1344],["q",732,1344,683,1375],["q",635,1407,635,1470],["q",635,1600,814,1600],["q",872,1600,938,1565],["q",1004,1531,1067,1531],["q",1092,1531,1136,1539],["q",1181,1547,1253,1587],["q",1325,1627,1382,1691],["q",1439,1755,1483,1882],["q",1528,2009,1528,2175],["q",1528,2814,991,2814],["q",766,2814,671,2698],["q",576,2583,576,2460],["q",576,2184,847,2110]]},"4":{"xoff":1984,"width":1856,"height":2880,"hbx":0,"hby":2880,"path":[["m",762,59],["l",762,5],["l",1788,5],["l",1788,59],["q",1535,59,1471,157],["q",1408,256,1408,573],["l",1408,697],["l",1478,697],["q",1661,697,1726,632],["q",1792,568,1792,373],["l",1792,320],["l",1856,320],["l",1856,1152],["l",1792,1152],["l",1792,1102],["q",1792,916,1709,839],["q",1626,763,1443,763],["l",1408,763],["l",1408,2880],["l",1342,2880],["l",32,733],["l",32,697],["l",1152,697],["l",1152,573],["q",1152,277,1077,168],["q",1002,59,762,59],["m",127,763],["l",1152,2437],["l",1152,763],["l",127,763]]},"5":{"xoff":1792,"width":1728,"height":3008,"hbx":-128,"hby":2880,"path":[["m",391,1257],["q",524,1657,827,1657],["q",990,1657,1095,1537],["q",1201,1418,1236,1271],["q",1272,1125,1272,960],["q",1272,613,1083,304],["q",894,-5,590,-5],["q",400,-5,300,84],["q",200,173,200,301],["q",200,523,174,591],["q",148,659,36,659],["q",-48,659,-88,591],["q",-128,523,-128,440],["q",-128,292,-42,183],["q",43,74,173,24],["q",304,-25,411,-48],["q",519,-71,604,-71],["q",970,-71,1285,228],["q",1600,527,1600,969],["q",1600,1302,1377,1512],["q",1154,1723,861,1723],["q",592,1723,462,1566],["l",682,2545],["q",836,2496,1128,2496],["q",1335,2496,1444,2578],["q",1554,2661,1554,2797],["q",1554,2832,1550,2839],["q",1497,2752,1233,2752],["q",803,2752,690,2814],["l",320,1286],["l",391,1257]]},"6":{"xoff":1984,"width":1792,"height":2944,"hbx":128,"hby":2880,"path":[["m",128,1226],["q",128,653,357,323],["q",587,-7,988,-7],["q",1339,-7,1601,285],["q",1864,578,1864,963],["q",1864,1341,1603,1596],["q",1343,1851,981,1851],["q",661,1851,476,1598],["q",476,1732,523,1928],["q",571,2124,653,2326],["q",735,2528,875,2671],["q",1015,2814,1175,2814],["q",1315,2814,1384,2759],["q",1454,2705,1466,2637],["q",1479,2570,1518,2515],["q",1557,2461,1639,2461],["q",1791,2461,1791,2598],["q",1791,2727,1660,2803],["q",1529,2880,1308,2880],["q",837,2880,482,2401],["q",128,1922,128,1226],["m",456,963],["q",456,1785,1001,1785],["q",1264,1785,1400,1557],["q",1536,1329,1536,963],["q",1536,548,1400,303],["q",1264,59,983,59],["q",736,59,596,318],["q",456,577,456,963]]},"7":{"xoff":1792,"width":1664,"height":2944,"hbx":64,"hby":2880,"path":[["m",503,2752],["q",422,2752,373,2783],["q",324,2814,316,2847],["l",312,2880],["l",283,2880],["l",111,2035],["l",140,2035],["q",148,2150,282,2291],["q",417,2432,625,2432],["l",1548,2432],["l",443,397],["q",430,373,401,324],["q",373,275,358,248],["q",344,221,332,178],["q",320,135,320,95],["q",320,37,365,2],["q",410,-32,474,-32],["q",589,-32,642,26],["q",696,84,760,253],["l",1728,2706],["l",1728,2752],["l",503,2752]]},"8":{"xoff":2112,"width":1728,"height":2944,"hbx":192,"hby":2880,"path":[["m",1920,764],["q",1920,551,1835,393],["q",1750,235,1612,153],["q",1474,71,1333,32],["q",1192,-7,1048,-7],["q",936,-7,797,32],["q",659,71,518,149],["q",378,227,285,370],["q",192,513,192,694],["q",192,1235,810,1453],["q",543,1593,399,1749],["q",256,1905,256,2168],["q",256,2346,316,2483],["q",376,2621,463,2693],["q",550,2765,663,2810],["q",777,2856,864,2868],["q",951,2880,1034,2880],["q",1348,2880,1570,2730],["q",1792,2580,1792,2271],["q",1792,1827,1247,1588],["q",1569,1440,1744,1261],["q",1920,1083,1920,764],["m",512,702],["q",512,498,575,358],["q",638,219,737,160],["q",837,101,916,80],["q",996,59,1073,59],["q",1145,59,1222,84],["q",1300,109,1389,166],["q",1478,223,1535,348],["q",1592,473,1592,650],["q",1592,801,1535,922],["q",1478,1043,1363,1135],["q",1248,1227,1140,1289],["q",1033,1351,867,1424],["q",741,1334,626,1143],["q",512,952,512,702],["m",1464,2245],["q",1464,2552,1318,2683],["q",1172,2814,959,2814],["q",512,2814,512,2339],["q",512,2047,676,1901],["q",840,1756,1178,1621],["q",1264,1675,1312,1726],["q",1361,1777,1412,1912],["q",1464,2047,1464,2245]]},"9":{"xoff":2048,"width":1792,"height":2944,"hbx":128,"hby":2880,"path":[["m",1864,1639],["q",1864,2213,1635,2546],["q",1406,2880,1004,2880],["q",652,2880,390,2583],["q",128,2287,128,1902],["q",128,1526,389,1271],["q",650,1017,1011,1017],["q",1331,1017,1516,1269],["q",1516,1133,1469,937],["q",1422,741,1339,541],["q",1257,341,1117,200],["q",977,59,817,59],["q",677,59,607,114],["q",537,169,525,232],["q",513,295,474,350],["q",435,406,353,406],["q",200,406,200,268],["q",200,139,331,66],["q",462,-7,684,-7],["q",1156,-7,1510,468],["q",1864,943,1864,1639],["m",1536,1902],["q",1536,1083,992,1083],["q",729,1083,592,1310],["q",456,1538,456,1902],["q",456,2317,592,2565],["q",729,2814,1009,2814],["q",1256,2814,1396,2550],["q",1536,2287,1536,1902]]}," ":{"xoff":1152,"width":0,"height":0,"hbx":0,"hby":0,"path":[]},"!":{"xoff":960,"width":512,"height":2880,"hbx":256,"hby":2816,"path":[["m",458,480],["l",502,480],["l",690,2513],["q",715,2784,479,2784],["q",355,2784,306,2705],["q",257,2626,269,2513],["l",458,480],["m",320,318],["q",256,252,256,158],["q",256,64,320,0],["q",385,-64,480,-64],["q",575,-64,639,0],["q",704,64,704,158],["q",704,252,639,318],["q",575,384,480,384],["q",385,384,320,318]]},"$":{"xoff":2112,"width":1792,"height":3648,"hbx":192,"hby":3136,"path":[["m",1024,1576],["l",1142,1576],["l",1142,3134],["l",1024,3134],["l",1024,1576],["m",1024,-450],["l",1142,-450],["l",1142,1441],["l",1024,1441],["l",1024,-450],["m",1094,-7],["q",1533,-7,1758,195],["q",1984,398,1984,746],["q",1984,982,1833,1166],["q",1683,1351,1465,1467],["q",1247,1583,1032,1691],["q",817,1800,664,1955],["q",512,2111,512,2307],["q",512,2454,566,2560],["q",621,2666,704,2717],["q",787,2768,860,2791],["q",934,2814,998,2814],["q",1233,2814,1348,2732],["q",1464,2651,1464,2528],["q",1464,2238,1639,2238],["q",1717,2238,1754,2277],["q",1792,2316,1792,2414],["q",1792,2608,1563,2744],["q",1334,2880,1010,2880],["q",702,2880,479,2689],["q",256,2499,256,2180],["q",256,1999,331,1858],["q",407,1717,523,1624],["q",640,1532,784,1452],["q",929,1373,1072,1295],["q",1216,1218,1333,1134],["q",1450,1050,1525,923],["q",1600,796,1600,636],["q",1600,366,1454,212],["q",1309,59,1092,59],["q",851,59,685,183],["q",520,308,520,431],["q",520,562,489,631],["q",458,700,366,700],["q",292,700,242,655],["q",192,611,192,525],["q",192,308,471,150],["q",750,-7,1094,-7]]},"%":{"xoff":1984,"width":1728,"height":2688,"hbx":128,"hby":2624,"path":[["m",614,2619],["q",405,2619,266,2465],["q",128,2311,128,2110],["q",128,1910,242,1751],["q",357,1593,550,1593],["q",747,1593,885,1747],["q",1024,1901,1024,2110],["q",1024,2319,907,2469],["q",791,2619,614,2619],["m",612,2553],["q",672,2553,720,2419],["q",768,2285,768,2106],["q",768,1921,714,1790],["q",661,1659,554,1659],["q",483,1659,433,1793],["q",384,1928,384,2106],["q",384,2261,451,2407],["q",519,2553,612,2553],["m",729,2494],["q",729,2507,716,2523],["q",704,2540,708,2538],["q",713,2536,751,2527],["q",887,2474,1070,2474],["q",1254,2474,1369,2486],["l",1480,2494],["l",294,28],["l",491,28],["l",1702,2590],["l",1484,2590],["q",1164,2465,627,2598],["q",602,2606,627,2590],["q",684,2547,692,2538],["l",729,2494],["m",1418,955],["q",1194,955,1045,803],["q",896,652,896,454],["q",896,257,1018,101],["q",1141,-54,1348,-54],["q",1559,-54,1707,97],["q",1856,249,1856,454],["q",1856,660,1731,807],["q",1607,955,1418,955],["m",1418,889],["q",1488,889,1544,757],["q",1600,625,1600,451],["q",1600,269,1538,140],["q",1476,12,1351,12],["q",1268,12,1210,144],["q",1152,276,1152,451],["q",1152,602,1231,745],["q",1310,889,1418,889]]},"&":{"xoff":2560,"width":2752,"height":2944,"hbx":128,"hby":2880,"path":[["m",456,854],["q",456,1073,561,1266],["q",667,1459,838,1565],["l",1638,434],["q",1515,258,1358,161],["q",1201,64,1058,64],["q",791,64,623,295],["q",456,526,456,854],["m",704,2483],["q",704,2640,805,2727],["q",906,2814,1036,2814],["q",1210,2814,1309,2701],["q",1408,2589,1408,2432],["q",1408,2226,1293,2026],["q",1178,1827,1080,1775],["q",1068,1795,1001,1879],["q",935,1964,911,1998],["q",887,2033,836,2109],["q",785,2186,764,2236],["q",744,2286,724,2354],["q",704,2423,704,2483],["m",2138,1342],["q",2210,1498,2299,1577],["q",2388,1657,2538,1657],["l",2570,1657],["l",2570,1723],["l",1775,1723],["l",1775,1657],["l",1807,1657],["q",2055,1657,2055,1426],["q",2055,1301,1976,1123],["l",1806,766],["l",1123,1711],["q",1127,1716,1235,1777],["q",1344,1839,1389,1876],["q",1434,1914,1514,1990],["q",1594,2067,1629,2162],["q",1664,2258,1664,2374],["q",1664,2639,1478,2759],["q",1292,2880,1056,2880],["q",856,2880,684,2734],["q",512,2589,512,2313],["q",512,2034,809,1607],["q",547,1498,337,1258],["q",128,1018,128,707],["q",128,341,331,143],["q",534,-54,884,-54],["q",1151,-54,1321,49],["q",1492,152,1672,392],["q",2048,-54,2451,-54],["q",2685,-54,2782,44],["q",2880,143,2880,291],["l",2816,291],["q",2816,216,2735,140],["q",2654,64,2567,64],["q",2384,64,2152,304],["q",1921,544,1846,716],["l",2138,1342]]},"(":{"xoff":1344,"width":1152,"height":3520,"hbx":0,"hby":2880,"path":[["m",1120,2880],["l",1120,2744],["q",1088,2727,1034,2694],["q",981,2661,844,2523],["q",708,2385,604,2209],["q",500,2033,414,1713],["q",328,1393,328,1012],["q",328,740,418,473],["q",508,207,642,12],["q",777,-182,899,-312],["q",1022,-442,1120,-508],["l",1120,-640],["q",1038,-640,859,-504],["q",680,-368,486,-152],["q",293,63,146,382],["q",0,702,0,1012],["q",0,1343,108,1657],["q",216,1971,370,2184],["q",525,2397,692,2560],["q",859,2723,975,2801],["q",1092,2880,1120,2880]]},")":{"xoff":1344,"width":1216,"height":3520,"hbx":0,"hby":2880,"path":[["m",32,2880],["l",32,2744],["q",65,2727,118,2694],["q",172,2661,310,2523],["q",449,2385,554,2209],["q",659,2033,745,1713],["q",832,1393,832,1012],["q",832,740,741,473],["q",650,207,514,12],["q",378,-182,254,-312],["q",131,-442,32,-508],["l",32,-640],["q",114,-640,294,-504],["q",475,-368,669,-152],["q",864,63,1012,382],["q",1160,702,1160,1012],["q",1160,1343,1051,1657],["q",943,1971,787,2184],["q",631,2397,462,2560],["q",294,2723,177,2801],["q",61,2880,32,2880]]},"*":{"xoff":1088,"width":1152,"height":1088,"hbx":64,"hby":3136,"path":[["m",558,2503],["q",517,2464,416,2406],["q",316,2348,254,2295],["q",192,2242,192,2179],["q",192,2123,232,2085],["q",272,2048,314,2048],["q",415,2048,467,2125],["q",520,2202,560,2308],["q",600,2415,650,2455],["q",688,2415,720,2308],["q",753,2202,797,2125],["q",841,2048,928,2048],["q",1024,2048,1024,2170],["q",1024,2253,981,2305],["q",938,2357,846,2414],["q",754,2471,717,2507],["q",798,2535,902,2519],["q",1007,2503,1095,2525],["q",1184,2547,1184,2633],["q",1184,2752,1077,2752],["q",996,2752,881,2669],["q",767,2586,694,2578],["q",694,2676,731,2795],["q",768,2914,768,3016],["q",768,3065,726,3100],["q",684,3136,638,3136],["q",592,3136,552,3102],["q",512,3069,512,3016],["q",512,2919,544,2797],["q",576,2676,576,2578],["q",520,2586,400,2669],["q",280,2752,188,2752],["q",64,2752,64,2637],["q",64,2552,163,2527],["q",262,2503,371,2517],["q",481,2532,558,2503]]},"+":{"xoff":2048,"width":1536,"height":1600,"hbx":256,"hby":1728,"path":[["m",950,1728],["l",950,968],["l",256,968],["l",256,832],["l",950,832],["l",950,128],["l",1088,128],["l",1088,832],["l",1792,832],["l",1792,968],["l",1088,968],["l",1088,1728],["l",950,1728]]},",":{"xoff":960,"width":576,"height":1088,"hbx":192,"hby":384,"path":[["m",438,-64],["q",541,-64,576,-4],["q",576,-195,461,-352],["q",346,-510,203,-592],["l",228,-646],["q",421,-575,567,-369],["q",714,-164,714,44],["q",714,208,636,296],["q",559,384,444,384],["q",347,384,285,313],["q",224,243,224,145],["q",224,52,285,-6],["q",347,-64,438,-64]]},"-":{"xoff":1408,"width":960,"height":192,"hbx":192,"hby":960,"path":[["m",1109,958],["l",1085,768],["l",192,768],["q",192,883,192,958],["l",1109,958]]},".":{"xoff":960,"width":448,"height":448,"hbx":256,"hby":384,"path":[["m",320,318],["q",256,252,256,158],["q",256,64,320,0],["q",385,-64,480,-64],["q",575,-64,639,0],["q",704,64,704,158],["q",704,252,639,318],["q",575,384,480,384],["q",385,384,320,318]]},":":{"xoff":960,"width":448,"height":1856,"hbx":256,"hby":1792,"path":[["m",320,1726],["q",256,1660,256,1566],["q",256,1472,320,1408],["q",385,1344,480,1344],["q",575,1344,639,1408],["q",704,1472,704,1566],["q",704,1660,639,1726],["q",575,1792,480,1792],["q",385,1792,320,1726],["m",320,318],["q",256,252,256,158],["q",256,64,320,0],["q",385,-64,480,-64],["q",575,-64,639,0],["q",704,64,704,158],["q",704,252,639,318],["q",575,384,480,384],["q",385,384,320,318]]},";":{"xoff":960,"width":576,"height":2432,"hbx":192,"hby":1792,"path":[["m",320,1727],["q",256,1663,256,1568],["q",256,1473,320,1408],["q",384,1344,479,1344],["q",575,1344,639,1408],["q",704,1473,704,1568],["q",704,1663,639,1727],["q",575,1792,479,1792],["q",384,1792,320,1727],["m",470,-64],["q",589,-64,630,-4],["q",630,-356,216,-551],["l",250,-605],["q",461,-534,614,-345],["q",768,-157,768,44],["q",768,208,682,296],["q",596,384,469,384],["q",361,384,292,313],["q",224,243,224,145],["q",224,52,294,-6],["q",365,-64,470,-64]]},"=":{"xoff":2048,"width":1408,"height":576,"hbx":320,"hby":1152,"path":[["m",320,576],["l",1728,576],["l",1728,708],["l",320,708],["l",320,576],["m",320,960],["l",1728,960],["l",1728,1092],["l",320,1092],["l",320,960]]},"?":{"xoff":1920,"width":1472,"height":2944,"hbx":256,"hby":2880,"path":[["m",552,1259],["q",630,1191,708,1168],["q",787,1145,935,1145],["q",1236,1145,1454,1355],["q",1672,1566,1672,1933],["q",1672,2153,1587,2339],["q",1503,2525,1373,2639],["q",1243,2753,1094,2816],["q",945,2880,809,2880],["q",624,2880,440,2764],["q",256,2649,256,2531],["q",256,2491,276,2464],["q",296,2438,329,2438],["q",453,2438,497,2607],["q",553,2814,766,2814],["q",991,2814,1167,2568],["q",1344,2323,1344,1927],["q",1344,1620,1241,1415],["q",1138,1211,916,1211],["q",511,1211,511,1728],["l",437,1728],["l",437,576],["l",552,576],["l",552,1259],["m",320,318],["q",256,252,256,158],["q",256,64,320,0],["q",385,-64,480,-64],["q",576,-64,640,0],["q",704,64,704,158],["q",704,252,640,318],["q",576,384,480,384],["q",385,384,320,318]]},"@":{"xoff":3200,"width":2816,"height":2880,"hbx":192,"hby":2304,"path":[["m",2354,-5],["q",2238,-5,2211,81],["q",2184,167,2184,369],["l",2184,1284],["q",2184,1787,1544,1787],["q",1351,1787,1165,1700],["q",980,1613,980,1468],["q",980,1395,1021,1348],["q",1063,1302,1127,1302],["q",1257,1302,1282,1460],["q",1305,1614,1362,1667],["q",1420,1721,1527,1721],["q",1618,1721,1683,1691],["q",1749,1662,1782,1622],["q",1816,1582,1831,1506],["q",1847,1430,1851,1373],["q",1856,1316,1856,1219],["q",1856,1093,1760,998],["q",1665,903,1529,882],["q",1182,835,1035,728],["q",888,621,888,371],["q",888,304,908,238],["q",928,173,978,97],["q",1028,22,1133,-24],["q",1239,-71,1390,-71],["q",1605,-71,1683,-34],["q",1761,3,1837,115],["q",1991,-71,2230,-71],["q",2428,-71,2586,41],["q",2745,153,2832,331],["q",2919,510,2963,701],["q",3008,892,3008,1074],["q",3008,1556,2622,1927],["q",2236,2299,1674,2299],["q",1016,2299,604,1890],["q",192,1482,192,970],["q",192,622,314,336],["q",436,50,639,-134],["q",843,-319,1103,-419],["q",1364,-519,1649,-519],["q",1922,-519,2137,-468],["q",2353,-417,2440,-365],["q",2528,-313,2528,-282],["q",2528,-259,2503,-259],["q",2495,-259,2467,-279],["q",2439,-300,2382,-328],["q",2325,-356,2240,-384],["q",2155,-412,2001,-432],["q",1848,-453,1653,-453],["q",1358,-453,1133,-337],["q",909,-222,779,-18],["q",649,185,584,435],["q",520,685,520,978],["q",520,1538,861,1885],["q",1203,2233,1701,2233],["q",2115,2233,2433,1906],["q",2752,1580,2752,1044],["q",2752,565,2642,280],["q",2532,-5,2354,-5],["m",1492,-5],["q",1371,-5,1307,53],["q",1243,111,1229,178],["q",1216,245,1216,350],["q",1216,437,1256,514],["q",1297,592,1375,654],["q",1453,717,1526,761],["q",1599,805,1702,863],["q",1805,922,1856,955],["l",1856,576],["q",1856,291,1782,143],["q",1708,-5,1492,-5]]},"A":{"xoff":2944,"width":2944,"height":2880,"hbx":0,"hby":2816,"path":[["m",2914,-7],["l",2914,59],["l",2864,59],["q",2566,59,2395,501],["l",1501,2777],["l",1489,2777],["l",519,619],["q",356,263,239,148],["q",144,59,51,59],["l",18,59],["l",18,-7],["l",921,-7],["l",921,59],["l",888,59],["q",722,59,649,158],["q",576,257,576,412],["q",576,553,640,707],["l",803,1073],["l",1749,1073],["l",1797,951],["q",1984,473,1984,306],["q",1984,59,1655,59],["l",1607,59],["l",1607,-7],["l",2914,-7],["m",1310,2205],["l",1716,1155],["l",840,1155],["l",1310,2205]]},"B":{"xoff":2752,"width":2560,"height":2816,"hbx":128,"hby":2816,"path":[["m",1352,1465],["q",1772,1465,1974,1329],["q",2176,1194,2176,794],["q",2176,441,1986,256],["q",1797,71,1474,71],["q",1243,71,1133,177],["q",1024,284,1024,564],["l",1024,1465],["l",1352,1465],["m",1024,2745],["l",1273,2745],["q",1984,2745,1984,2121],["q",1984,1814,1828,1672],["q",1673,1531,1314,1531],["l",1024,1531],["l",1024,2745],["m",185,2811],["l",185,2745],["l",234,2745],["q",640,2745,640,2276],["l",640,564],["q",640,321,517,196],["q",394,71,205,71],["l",160,71],["l",160,5],["l",1697,5],["q",1981,5,2098,28],["q",2215,51,2343,131],["q",2478,220,2583,408],["q",2688,597,2688,770],["q",2688,943,2614,1081],["q",2540,1219,2432,1301],["q",2325,1383,2194,1437],["q",2064,1492,1965,1511],["q",1866,1531,1796,1531],["q",2432,1682,2432,2181],["q",2432,2406,2298,2551],["q",2164,2696,1971,2753],["q",1779,2811,1539,2811],["l",185,2811]]},"C":{"xoff":2752,"width":2496,"height":2944,"hbx":192,"hby":2880,"path":[["m",2591,1920],["q",2468,2419,2231,2616],["q",1995,2814,1622,2814],["q",1207,2814,923,2403],["q",640,1992,640,1409],["q",640,827,932,445],["q",1224,64,1689,64],["q",2114,64,2369,279],["q",2624,494,2624,805],["l",2688,805],["q",2688,578,2586,404],["q",2484,231,2321,136],["q",2159,41,1986,-6],["q",1814,-54,1641,-54],["q",976,-54,584,332],["q",192,719,192,1412],["q",192,1998,594,2439],["q",997,2880,1585,2880],["q",1872,2880,2155,2790],["q",2439,2700,2451,2700],["q",2492,2700,2523,2738],["q",2554,2777,2562,2816],["l",2616,2816],["l",2616,1920],["l",2591,1920]]},"D":{"xoff":3264,"width":2944,"height":2816,"hbx":128,"hby":2752,"path":[["m",1440,59],["q",1328,59,1270,69],["q",1213,79,1146,123],["q",1080,168,1052,272],["q",1024,377,1024,547],["l",1024,2681],["l",1379,2681],["q",1640,2681,1858,2591],["q",2077,2502,2216,2363],["q",2355,2225,2449,2048],["q",2543,1871,2583,1704],["q",2624,1537,2624,1382],["q",2624,869,2294,464],["q",1965,59,1440,59],["m",1647,-7],["q",2044,-7,2333,111],["q",2622,229,2777,432],["q",2932,636,3002,868],["q",3072,1101,3072,1370],["q",3072,1561,3028,1742],["q",2985,1924,2875,2111],["q",2766,2299,2597,2435],["q",2428,2571,2151,2659],["q",1874,2747,1523,2747],["l",189,2747],["l",189,2706],["l",238,2706],["q",640,2706,640,2241],["l",640,547],["q",640,307,517,183],["q",394,59,205,59],["l",160,59],["l",160,-7],["l",1647,-7]]},"E":{"xoff":2688,"width":2496,"height":2816,"hbx":128,"hby":2816,"path":[["m",640,564],["q",640,321,518,196],["q",397,71,210,71],["l",165,71],["l",165,5],["l",2624,5],["l",2624,845],["l",2598,845],["q",2519,71,1695,71],["q",1347,71,1185,191],["q",1024,312,1024,567],["l",1024,1465],["l",1254,1465],["q",1472,1465,1600,1339],["q",1728,1214,1728,1003],["l",1728,960],["l",1792,960],["l",1792,2048],["l",1728,2048],["l",1728,2001],["q",1728,1531,1292,1531],["l",1024,1531],["l",1024,2745],["l",1527,2745],["q",2321,2745,2367,2167],["l",2400,2167],["l",2400,2811],["l",190,2811],["l",190,2745],["l",239,2745],["q",640,2745,640,2276],["l",640,564]]},"F":{"xoff":2496,"width":2304,"height":2880,"hbx":128,"hby":2816,"path":[["m",1088,1465],["l",1298,1465],["q",1496,1465,1612,1324],["q",1728,1183,1728,944],["l",1728,896],["l",1792,896],["l",1792,1984],["l",1728,1984],["l",1728,1943],["q",1728,1531,1332,1531],["l",1088,1531],["l",1088,2745],["l",1567,2745],["q",2323,2745,2367,2114],["l",2400,2114],["l",2400,2811],["l",198,2811],["l",198,2745],["l",246,2745],["q",640,2745,640,2273],["l",640,555],["q",640,310,517,184],["q",395,59,210,59],["l",165,59],["l",165,-7],["l",1530,-7],["l",1530,59],["l",1488,59],["q",1317,59,1202,187],["q",1088,316,1088,556],["l",1088,1465]]},"G":{"xoff":3264,"width":2944,"height":2944,"hbx":192,"hby":2880,"path":[["m",192,1436],["q",192,733,569,363],["q",946,-7,1642,-7],["q",2173,-7,2534,297],["l",2688,269],["l",2688,729],["q",2688,826,2723,888],["q",2759,951,2826,975],["q",2893,1000,2947,1008],["q",3001,1017,3080,1017],["l",3136,1017],["l",3136,1083],["l",1792,1083],["l",1792,1017],["l",1837,1017],["q",2240,1017,2240,657],["q",2240,604,2226,539],["q",2212,475,2172,386],["q",2132,298,2068,227],["q",2005,156,1894,107],["q",1784,59,1644,59],["q",1248,59,976,461],["q",704,863,704,1434],["q",704,2009,978,2411],["q",1253,2814,1653,2814],["q",1998,2814,2220,2613],["q",2443,2412,2559,1920],["l",2584,1920],["l",2584,2816],["l",2529,2816],["q",2520,2777,2490,2738],["q",2460,2700,2419,2700],["q",2383,2700,2275,2746],["q",2168,2792,1998,2836],["q",1828,2880,1641,2880],["q",1014,2880,603,2467],["q",192,2054,192,1436]]},"H":{"xoff":3584,"width":3328,"height":2880,"hbx":128,"hby":2816,"path":[["m",2560,1467],["l",1024,1467],["l",1024,2267],["q",1024,2745,1430,2745],["l",1480,2745],["l",1480,2811],["l",189,2811],["l",189,2745],["l",238,2745],["q",640,2745,640,2273],["l",640,555],["q",640,310,517,184],["q",394,59,205,59],["l",160,59],["l",160,-7],["l",1509,-7],["l",1509,59],["l",1463,59],["q",1271,59,1147,184],["q",1024,310,1024,554],["l",1024,1401],["l",2560,1401],["l",2560,554],["q",2560,310,2436,184],["q",2313,59,2121,59],["l",2075,59],["l",2075,-7],["l",3423,-7],["l",3423,59],["l",3378,59],["q",3190,59,3067,184],["q",2944,310,2944,555],["l",2944,2273],["q",2944,2745,3346,2745],["l",3395,2745],["l",3395,2811],["l",2104,2811],["l",2104,2745],["l",2154,2745],["q",2560,2745,2560,2267],["l",2560,1467]]},"I":{"xoff":1664,"width":1408,"height":2880,"hbx":128,"hby":2816,"path":[["m",189,2811],["l",189,2745],["l",238,2745],["q",640,2745,640,2273],["l",640,555],["q",640,310,517,184],["q",394,59,205,59],["l",160,59],["l",160,-7],["l",1504,-7],["l",1504,59],["l",1458,59],["q",1270,59,1147,184],["q",1024,310,1024,555],["l",1024,2273],["q",1024,2745,1426,2745],["l",1475,2745],["l",1475,2811],["l",189,2811]]},"J":{"xoff":1856,"width":1920,"height":3584,"hbx":-128,"hby":2816,"path":[["m",896,-74],["q",896,-645,542,-645],["q",494,-645,453,-628],["q",412,-612,390,-593],["q",368,-575,343,-531],["q",318,-488,312,-471],["q",306,-455,290,-396],["l",269,-339],["q",209,-157,83,-157],["q",13,-157,-41,-206],["q",-96,-256,-96,-363],["q",-96,-526,92,-618],["q",280,-711,488,-711],["q",876,-711,1078,-542],["q",1280,-374,1280,-91],["l",1280,2271],["q",1280,2745,1681,2745],["l",1730,2745],["l",1730,2811],["l",451,2811],["l",451,2745],["l",501,2745],["q",896,2745,896,2273],["l",896,-74]]},"K":{"xoff":3072,"width":3008,"height":2880,"hbx":128,"hby":2816,"path":[["m",189,2811],["l",189,2745],["l",238,2745],["q",640,2745,640,2273],["l",640,555],["q",640,310,517,184],["q",394,59,205,59],["l",160,59],["l",160,-7],["l",1513,-7],["l",1513,59],["l",1467,59],["q",1275,59,1149,184],["q",1024,310,1024,555],["l",1024,1266],["l",1254,1481],["l",2035,468],["q",2144,327,2144,244],["q",2144,158,2066,108],["q",1989,59,1872,59],["l",1826,59],["l",1826,-7],["l",3101,-7],["l",3101,59],["l",3055,59],["q",2964,59,2854,139],["q",2745,220,2670,319],["l",1559,1762],["l",1971,2145],["q",2594,2745,2765,2745],["l",2794,2745],["l",2794,2811],["l",1943,2811],["l",1943,2745],["l",1977,2745],["q",2071,2745,2139,2703],["q",2208,2662,2208,2580],["q",2208,2551,2193,2514],["q",2179,2477,2149,2437],["q",2120,2398,2090,2361],["q",2061,2324,2009,2274],["q",1957,2225,1921,2192],["q",1885,2159,1822,2100],["q",1759,2042,1725,2013],["l",1024,1365],["l",1024,2274],["q",1024,2745,1434,2745],["l",1484,2745],["l",1484,2811],["l",189,2811]]},"L":{"xoff":2688,"width":2496,"height":2816,"hbx":128,"hby":2816,"path":[["m",640,564],["q",640,321,518,196],["q",397,71,210,71],["l",165,71],["l",165,5],["l",2624,5],["l",2624,823],["l",2595,823],["q",2516,71,1694,71],["q",1347,71,1185,192],["q",1024,313,1024,568],["l",1024,2276],["q",1024,2745,1430,2745],["l",1479,2745],["l",1479,2811],["l",194,2811],["l",194,2745],["l",243,2745],["q",640,2745,640,2276],["l",640,564]]},"M":{"xoff":3840,"width":3648,"height":2880,"hbx":64,"hby":2816,"path":[["m",1906,571],["l",983,2811],["l",155,2811],["l",155,2745],["l",203,2745],["q",355,2745,427,2714],["q",500,2683,532,2580],["q",576,2435,576,1840],["l",576,555],["q",576,310,466,184],["q",357,59,171,59],["l",126,59],["l",126,-7],["l",1085,-7],["l",1085,59],["l",1040,59],["q",856,59,748,184],["q",640,310,640,555],["l",640,2625],["l",1718,-7],["l",1742,-7],["l",2816,2625],["l",2816,555],["q",2816,310,2694,184],["q",2572,59,2383,59],["l",2338,59],["l",2338,-7],["l",3687,-7],["l",3687,59],["l",3641,59],["q",3450,59,3325,184],["q",3200,310,3200,555],["q",3200,1609,3200,1840],["q",3200,2464,3245,2568],["q",3318,2745,3556,2745],["l",3605,2745],["l",3605,2811],["l",2812,2811],["l",1906,571]]},"N":{"xoff":3200,"width":3072,"height":2880,"hbx":64,"hby":2816,"path":[["m",878,2811],["l",133,2811],["l",133,2745],["l",182,2745],["q",576,2745,576,2286],["l",576,555],["q",576,310,463,184],["q",350,59,166,59],["l",121,59],["l",121,-7],["l",1087,-7],["l",1087,59],["l",1042,59],["q",857,59,748,184],["q",640,310,640,554],["l",640,2476],["l",2626,-39],["l",2678,-39],["l",2678,1834],["q",2678,2362,2760,2553],["q",2842,2745,3051,2745],["l",3083,2745],["l",3083,2811],["l",2170,2811],["l",2170,2745],["l",2203,2745],["q",2413,2745,2486,2559],["q",2560,2373,2560,1840],["l",2560,687],["l",878,2811]]},"O":{"xoff":3328,"width":2944,"height":2944,"hbx":192,"hby":2880,"path":[["m",625,2452],["q",192,2025,192,1436],["q",192,848,625,420],["q",1059,-7,1664,-7],["q",2269,-7,2702,420],["q",3136,848,3136,1436],["q",3136,2025,2702,2452],["q",2269,2880,1664,2880],["q",1059,2880,625,2452],["m",704,1434],["q",704,2009,980,2411],["q",1257,2814,1660,2814],["q",2067,2814,2345,2411],["q",2624,2009,2624,1434],["q",2624,863,2345,461],["q",2067,59,1660,59],["q",1257,59,980,461],["q",704,863,704,1434]]},"P":{"xoff":2624,"width":2304,"height":2880,"hbx":128,"hby":2816,"path":[["m",2432,2071],["q",2432,2410,2242,2610],["q",2052,2811,1675,2811],["l",193,2811],["l",193,2745],["l",242,2745],["q",640,2745,640,2273],["l",640,555],["q",640,310,517,184],["q",394,59,205,59],["l",160,59],["l",160,-7],["l",1521,-7],["l",1521,59],["l",1474,59],["q",1281,59,1152,183],["q",1024,308,1024,541],["l",1024,1337],["q",1298,1337,1445,1337],["q",1664,1337,1825,1364],["q",1986,1392,2131,1468],["q",2277,1544,2354,1695],["q",2432,1847,2432,2071],["m",1024,2745],["q",1222,2745,1335,2737],["q",1449,2729,1590,2693],["q",1731,2657,1805,2588],["q",1880,2520,1932,2392],["q",1984,2265,1984,2079],["q",1984,1865,1915,1723],["q",1847,1582,1718,1515],["q",1590,1448,1461,1425],["q",1332,1403,1157,1403],["q",1136,1403,1091,1403],["q",1046,1403,1024,1403],["l",1024,2745]]},"Q":{"xoff":3392,"width":3264,"height":3456,"hbx":192,"hby":2880,"path":[["m",192,1436],["q",192,827,626,410],["q",1061,-7,1737,-7],["q",1842,-144,1900,-212],["q",1959,-281,2076,-383],["q",2193,-485,2337,-530],["q",2481,-576,2657,-576],["q",2879,-576,3040,-499],["q",3201,-423,3278,-325],["q",3355,-228,3399,-86],["q",3443,55,3449,131],["q",3456,208,3456,297],["l",3392,297],["q",3392,91,3232,-82],["q",3073,-256,2746,-256],["q",2605,-256,2481,-203],["q",2357,-151,2288,-93],["q",2220,-35,2120,70],["q",2566,217,2851,595],["q",3136,974,3136,1435],["q",3136,2025,2702,2452],["q",2269,2880,1664,2880],["q",1059,2880,625,2452],["q",192,2025,192,1436],["m",704,1424],["q",704,2003,980,2408],["q",1257,2814,1660,2814],["q",2067,2814,2345,2410],["q",2624,2007,2624,1430],["q",2624,1001,2461,655],["q",2298,309,2027,153],["q",1898,261,1769,320],["q",1640,379,1455,379],["q",1184,379,1091,297],["q",910,486,807,782],["q",704,1079,704,1424],["m",1123,271],["q",1175,313,1297,313],["q",1401,313,1488,248],["q",1575,184,1684,59],["q",1361,59,1123,271]]},"R":{"xoff":3136,"width":3072,"height":2880,"hbx":128,"hby":2816,"path":[["m",1024,2745],["q",1222,2745,1335,2737],["q",1449,2729,1590,2693],["q",1731,2657,1805,2588],["q",1880,2520,1932,2392],["q",1984,2265,1984,2079],["q",1984,1865,1915,1723],["q",1847,1582,1718,1515],["q",1590,1448,1461,1425],["q",1332,1403,1157,1403],["q",1136,1403,1091,1403],["q",1046,1403,1024,1403],["l",1024,2745],["m",1024,1337],["q",1183,1337,1279,1337],["q",1376,1337,1470,1302],["q",1565,1268,1614,1237],["q",1664,1206,1741,1108],["q",1818,1010,1867,926],["q",1917,843,2025,659],["l",2406,-7],["l",3194,-7],["l",3194,59],["q",3026,59,2931,101],["q",2837,144,2724,279],["q",2612,414,2411,733],["q",2348,831,2275,960],["q",2202,1089,2170,1140],["q",2138,1191,2082,1252],["q",2026,1314,1959,1338],["q",1892,1363,1787,1379],["q",2118,1456,2275,1599],["q",2432,1742,2432,2071],["q",2432,2405,2238,2608],["q",2045,2811,1670,2811],["l",193,2811],["l",193,2745],["l",242,2745],["q",640,2745,640,2273],["l",640,555],["q",640,310,517,184],["q",394,59,205,59],["l",160,59],["l",160,-7],["l",1521,-7],["l",1521,59],["l",1474,59],["q",1281,59,1152,183],["q",1024,308,1024,541],["l",1024,1337]]},"S":{"xoff":2112,"width":1792,"height":2944,"hbx":192,"hby":2880,"path":[["m",1600,636],["q",1600,366,1458,212],["q",1317,59,1098,59],["q",904,59,746,130],["q",588,201,497,301],["q",406,402,340,516],["q",275,631,252,712],["q",229,793,229,832],["l",194,832],["l",194,0],["l",258,0],["q",258,134,382,134],["q",424,134,649,63],["q",874,-7,1094,-7],["q",1520,-7,1752,237],["q",1984,481,1984,838],["q",1984,1064,1881,1226],["q",1779,1388,1621,1471],["q",1463,1555,1280,1637],["q",1097,1719,941,1789],["q",785,1859,680,1994],["q",576,2130,576,2314],["q",576,2434,613,2525],["q",650,2617,703,2671],["q",756,2725,823,2759],["q",891,2794,946,2804],["q",1001,2814,1050,2814],["q",1254,2814,1423,2650],["q",1593,2487,1671,2315],["q",1749,2143,1749,2048],["l",1792,2048],["l",1792,2816],["l",1728,2816],["q",1728,2695,1587,2695],["q",1534,2695,1353,2787],["q",1173,2880,1028,2880],["q",722,2880,490,2663],["q",258,2446,258,2122],["q",258,1926,332,1783],["q",407,1640,525,1556],["q",643,1472,787,1404],["q",931,1336,1073,1274],["q",1215,1213,1333,1137],["q",1451,1062,1525,935],["q",1600,809,1600,636]]},"T":{"xoff":2880,"width":2880,"height":2816,"hbx":0,"hby":2752,"path":[["m",2815,2747],["l",65,2747],["l",7,2045],["l",65,2045],["q",89,2330,302,2505],["q",515,2681,900,2681],["l",1216,2681],["l",1216,548],["q",1216,307,1093,183],["q",970,59,782,59],["l",683,59],["l",683,-7],["l",2196,-7],["l",2196,59],["l",2098,59],["q",1909,59,1786,183],["q",1664,307,1664,548],["l",1664,2681],["l",1979,2681],["q",2364,2681,2577,2505],["q",2790,2330,2815,2045],["l",2872,2045],["l",2815,2747]]},"U":{"xoff":3200,"width":3072,"height":2880,"hbx":64,"hby":2816,"path":[["m",2570,942],["q",2570,504,2392,279],["q",2215,54,1781,54],["q",960,54,960,847],["l",960,2274],["q",960,2745,1362,2745],["l",1411,2745],["l",1411,2811],["l",125,2811],["l",125,2745],["l",175,2745],["q",576,2745,576,2274],["l",576,746],["q",576,287,838,111],["q",1100,-64,1696,-64],["q",2209,-64,2448,154],["q",2688,373,2688,845],["l",2688,1840],["q",2688,2365,2770,2555],["q",2852,2745,3061,2745],["l",3093,2745],["l",3093,2811],["l",2181,2811],["l",2181,2745],["l",2214,2745],["q",2426,2745,2498,2561],["q",2570,2378,2570,1841],["l",2570,942]]},"V":{"xoff":2816,"width":2944,"height":2880,"hbx":-64,"hby":2816,"path":[["m",-33,2811],["l",-33,2745],["l",16,2745],["q",85,2745,142,2734],["q",200,2724,242,2693],["q",285,2662,311,2643],["q",338,2625,369,2565],["q",400,2506,410,2487],["q",420,2468,449,2392],["q",478,2316,482,2299],["l",1393,-7],["l",1438,-7],["l",2324,2303],["q",2495,2745,2793,2745],["l",2826,2745],["l",2826,2811],["l",1922,2811],["l",1922,2745],["l",1954,2745],["q",2240,2745,2240,2460],["q",2240,2279,2077,1856],["l",1580,567],["l",1084,1836],["q",896,2324,896,2493],["q",896,2745,1226,2745],["l",1275,2745],["l",1275,2811],["l",-33,2811]]},"W":{"xoff":4480,"width":4608,"height":2880,"hbx":-64,"hby":2816,"path":[["m",2253,2230],["l",1510,-7],["l",1465,-7],["l",566,2164],["q",526,2267,503,2315],["q",481,2363,425,2460],["q",370,2558,321,2608],["q",272,2658,197,2701],["q",122,2745,40,2745],["l",-9,2745],["l",-9,2811],["l",1278,2811],["l",1278,2745],["l",1229,2745],["q",896,2745,896,2525],["q",896,2421,1054,2010],["l",1627,562],["l",2110,2010],["q",2176,2193,2176,2338],["q",2176,2521,2086,2633],["q",1997,2745,1798,2745],["l",1749,2745],["l",1749,2811],["l",3029,2811],["l",3029,2745],["l",2980,2745],["q",2624,2745,2624,2458],["q",2624,2347,2681,2164],["l",3201,562],["l",3785,2010],["q",3904,2310,3904,2466],["q",3904,2745,3601,2745],["l",3569,2745],["l",3569,2811],["l",4493,2811],["l",4493,2745],["l",4461,2745],["q",4383,2745,4323,2732],["q",4264,2720,4213,2674],["q",4162,2628,4133,2601],["q",4104,2575,4059,2477],["q",4014,2380,3997,2342],["q",3981,2305,3924,2164],["l",3049,-7],["l",3004,-7],["l",2253,2230]]},"X":{"xoff":2880,"width":3136,"height":2880,"hbx":-64,"hby":2816,"path":[["m",694,625],["q",690,621,643,557],["q",597,493,556,441],["q",516,390,445,313],["q",374,236,308,184],["q",243,133,160,96],["q",78,59,5,59],["l",-28,59],["l",-28,-7],["l",945,-7],["l",945,59],["l",913,59],["q",640,59,640,245],["q",640,431,889,753],["l",1303,1303],["l",1649,803],["q",1920,411,1920,249],["q",1920,59,1611,59],["l",1562,59],["l",1562,-7],["l",3016,-7],["l",3016,59],["l",2966,59],["q",2655,59,2269,609],["l",1558,1621],["l",2042,2217],["q",2046,2221,2100,2291],["q",2154,2361,2179,2390],["q",2204,2419,2266,2485],["q",2329,2551,2374,2586],["q",2420,2621,2484,2664],["q",2549,2708,2613,2726],["q",2678,2745,2741,2745],["l",2775,2745],["l",2775,2811],["l",1834,2811],["l",1834,2745],["l",1869,2745],["q",2144,2745,2144,2588],["q",2144,2448,1864,2108],["l",1513,1679],["l",1295,2001],["q",1024,2394,1024,2576],["q",1024,2745,1263,2745],["l",1312,2745],["l",1312,2811],["l",13,2811],["l",13,2745],["l",61,2745],["q",151,2745,228,2716],["q",305,2687,379,2608],["q",454,2530,489,2491],["q",524,2452,603,2330],["q",682,2208,690,2196],["l",1262,1357],["l",694,625]]},"Y":{"xoff":2688,"width":2944,"height":2880,"hbx":-128,"hby":2816,"path":[["m",2114,2092],["q",2255,2340,2429,2542],["q",2604,2745,2757,2745],["l",2790,2745],["l",2790,2811],["l",1892,2811],["l",1892,2745],["l",1924,2745],["q",2176,2745,2176,2526],["q",2176,2360,1967,1989],["l",1653,1430],["l",1565,1290],["q",1526,1352,1491,1410],["l",1060,2108],["q",864,2423,864,2547],["q",864,2745,1192,2745],["l",1244,2745],["l",1244,2811],["l",-87,2811],["l",-87,2745],["l",-37,2745],["q",63,2745,148,2703],["q",233,2662,307,2575],["q",381,2489,418,2431],["q",456,2373,522,2261],["l",990,1473],["q",1081,1315,1116,1207],["q",1152,1100,1152,931],["l",1152,555],["q",1152,310,1027,184],["q",903,59,709,59],["l",663,59],["l",663,-7],["l",2064,-7],["l",2064,59],["l",2020,59],["q",1840,59,1720,187],["q",1600,315,1600,555],["l",1600,931],["q",1600,1096,1634,1207],["q",1668,1319,1753,1468],["l",2114,2092]]},"Z":{"xoff":2944,"width":2496,"height":2816,"hbx":192,"hby":2752,"path":[["m",192,16],["l",192,-7],["l",2688,-7],["l",2688,846],["l",2663,846],["q",2592,503,2344,281],["q",2097,59,1754,59],["l",729,59],["l",2514,2711],["l",2514,2747],["l",324,2747],["l",254,2034],["l",308,2034],["q",489,2681,1151,2681],["l",2018,2681],["l",192,16]]},"^":{"xoff":1664,"width":1216,"height":704,"hbx":192,"hby":2624,"path":[["m",1200,1920],["l",1364,1920],["l",897,2592],["l",709,2592],["l",242,1920],["l",406,1920],["l",803,2299],["l",1200,1920]]},"`":{"xoff":1408,"width":960,"height":704,"hbx":256,"hby":2752,"path":[["m",1010,2048],["l",1162,2048],["l",518,2667],["q",465,2720,404,2720],["q",338,2720,297,2677],["q",256,2635,256,2570],["q",256,2489,355,2429],["l",1010,2048]]},"a":{"xoff":1856,"width":1792,"height":1856,"hbx":128,"hby":1728,"path":[["m",128,356],["q",128,291,148,227],["q",169,164,221,91],["q",273,19,382,-26],["q",492,-71,650,-71],["q",874,-71,961,-34],["q",1048,3,1127,107],["q",1289,-71,1528,-71],["q",1656,-71,1734,-40],["q",1813,-9,1834,18],["q",1856,46,1878,98],["l",1845,115],["q",1820,74,1804,53],["q",1788,32,1749,13],["q",1710,-5,1652,-5],["q",1542,-5,1511,81],["q",1480,168,1480,359],["l",1480,1239],["q",1480,1509,1302,1616],["q",1125,1723,812,1723],["q",610,1723,415,1638],["q",221,1554,221,1413],["q",221,1342,264,1297],["q",308,1252,374,1252],["q",502,1252,527,1404],["q",553,1554,617,1605],["q",681,1657,792,1657],["q",896,1657,968,1628],["q",1041,1600,1076,1561],["q",1111,1523,1131,1447],["q",1152,1372,1152,1321],["q",1152,1271,1152,1173],["q",1152,1055,1046,963],["q",941,872,792,848],["q",128,734,128,356],["m",747,-5],["q",620,-5,552,51],["q",485,107,470,171],["q",456,235,456,336],["q",456,452,534,548],["q",612,645,704,695],["q",796,745,943,811],["q",1090,877,1152,917],["l",1152,553],["q",1152,287,1066,141],["q",980,-5,747,-5]]},"b":{"xoff":2112,"width":1984,"height":2944,"hbx":64,"hby":2880,"path":[["m",539,109],["q",556,109,759,51],["q",963,-7,1122,-7],["q",1541,-7,1766,258],["q",1992,524,1992,922],["q",1992,1304,1742,1577],["q",1493,1851,1115,1851],["q",996,1851,879,1809],["q",763,1768,711,1733],["q",660,1698,640,1677],["l",640,2880],["l",605,2880],["q",185,2812,85,2804],["l",85,2760],["q",294,2760,339,2684],["q",384,2608,384,2312],["l",384,-7],["l",434,-7],["q",462,109,539,109],["m",640,922],["q",640,1390,719,1587],["q",798,1785,1067,1785],["q",1359,1785,1511,1542],["q",1664,1300,1664,922],["q",1664,561,1512,310],["q",1361,59,1062,59],["q",939,59,857,98],["q",775,138,730,196],["q",685,254,662,380],["q",640,507,640,613],["q",640,719,640,922]]},"c":{"xoff":1664,"width":1536,"height":1856,"hbx":128,"hby":1792,"path":[["m",980,1787],["q",607,1787,367,1516],["q",128,1246,128,861],["q",128,444,357,190],["q",587,-64,1016,-64],["q",1593,-64,1658,412],["l",1612,412],["q",1568,234,1462,144],["q",1357,54,1111,54],["q",456,54,456,865],["q",456,1230,597,1475],["q",739,1721,982,1721],["q",1147,1721,1200,1671],["q",1253,1622,1285,1457],["q",1313,1317,1455,1317],["q",1519,1317,1559,1358],["q",1600,1400,1600,1470],["q",1600,1626,1399,1706],["q",1199,1787,980,1787]]},"d":{"xoff":2176,"width":1984,"height":2944,"hbx":128,"hby":2880,"path":[["m",1527,1623],["q",1351,1851,1004,1851],["q",627,1851,377,1577],["q",128,1304,128,922],["q",128,524,355,258],["q",582,-7,1004,-7],["q",1335,-7,1507,227],["l",1531,-7],["l",1564,-7],["q",1686,24,1813,41],["q",1941,59,2010,59],["l",2078,59],["l",2078,123],["q",1898,123,1845,188],["q",1792,254,1792,471],["l",1792,2880],["l",1752,2880],["q",1331,2812,1229,2804],["l",1229,2760],["q",1437,2760,1482,2685],["q",1527,2611,1527,2320],["l",1527,1623],["m",1544,922],["q",1544,478,1427,268],["q",1310,59,1012,59],["q",807,59,678,189],["q",550,320,503,503],["q",456,686,456,922],["q",456,1312,589,1548],["q",722,1785,1012,1785],["q",1306,1785,1425,1573],["q",1544,1362,1544,922]]},"e":{"xoff":1856,"width":1664,"height":1856,"hbx":128,"hby":1792,"path":[["m",1728,1145],["q",1728,1462,1489,1624],["q",1251,1787,982,1787],["q",605,1787,366,1516],["q",128,1246,128,861],["q",128,444,362,190],["q",596,-64,1036,-64],["q",1350,-64,1528,65],["q",1706,194,1753,404],["l",1706,404],["q",1632,230,1505,142],["q",1378,54,1129,54],["q",456,54,456,843],["q",456,1008,468,1145],["l",1728,1145],["m",974,1721],["q",1195,1721,1297,1595],["q",1400,1470,1400,1211],["l",477,1211],["q",510,1458,624,1589],["q",739,1721,974,1721]]},"f":{"xoff":1152,"width":1344,"height":2944,"hbx":128,"hby":2880,"path":[["m",128,1657],["l",448,1657],["l",448,553],["q",448,257,401,158],["q",355,59,173,59],["l",173,-7],["l",1003,-7],["l",1003,59],["q",799,59,751,151],["q",704,244,704,553],["l",704,1657],["l",1216,1657],["l",1216,1723],["l",704,1723],["l",704,2250],["q",704,2814,975,2814],["q",1047,2814,1088,2783],["q",1130,2752,1193,2621],["q",1197,2613,1211,2582],["q",1226,2551,1230,2542],["q",1234,2534,1249,2513],["q",1264,2493,1274,2487],["q",1284,2481,1303,2474],["q",1322,2468,1342,2468],["q",1472,2468,1472,2607],["q",1472,2683,1417,2741],["q",1362,2800,1278,2826],["q",1194,2853,1118,2866],["q",1042,2880,985,2880],["q",833,2880,724,2833],["q",616,2787,563,2728],["q",510,2669,483,2566],["q",457,2464,452,2409],["q",448,2354,448,2265],["l",448,1723],["l",128,1723],["l",128,1657]]},"g":{"xoff":1792,"width":1728,"height":2624,"hbx":128,"hby":1792,"path":[["m",1496,1721],["q",1568,1721,1608,1649],["q",1668,1549,1752,1549],["q",1856,1549,1856,1645],["q",1856,1710,1792,1748],["q",1728,1787,1624,1787],["q",1448,1787,1272,1666],["q",1087,1787,873,1787],["q",625,1787,435,1607],["q",246,1427,246,1188],["q",246,1014,358,876],["q",471,739,635,683],["q",417,648,331,543],["q",246,439,246,333],["q",246,195,363,97],["q",481,0,666,0],["l",966,0],["q",1472,0,1472,-334],["q",1472,-358,1463,-395],["q",1455,-432,1420,-499],["q",1386,-567,1328,-624],["q",1270,-682,1149,-724],["q",1028,-766,872,-766],["q",543,-766,395,-641],["q",247,-516,247,-377],["q",247,-238,302,-183],["q",357,-128,423,-128],["q",506,-128,550,-160],["q",594,-193,594,-230],["q",639,-209,639,-145],["q",639,-91,576,-50],["q",514,-10,412,-10],["q",318,-10,223,-87],["q",128,-165,128,-348],["q",128,-527,253,-641],["q",378,-756,531,-794],["q",684,-832,869,-832],["q",975,-832,1100,-807],["q",1225,-783,1376,-724],["q",1527,-666,1627,-541],["q",1728,-416,1728,-244],["q",1728,-18,1555,119],["q",1382,256,1105,256],["l",726,256],["q",384,256,384,433],["q",384,532,518,593],["q",652,654,729,641],["q",778,633,851,633],["q",1099,633,1285,797],["q",1472,962,1472,1204],["q",1472,1441,1312,1633],["q",1340,1666,1400,1693],["q",1460,1721,1496,1721],["m",574,1208],["q",574,1721,887,1721],["q",1216,1721,1216,1208],["q",1216,699,887,699],["q",574,699,574,1208]]},"h":{"xoff":2240,"width":2048,"height":2880,"hbx":128,"hby":2880,"path":[["m",448,559],["q",448,259,401,159],["q",354,59,169,59],["l",169,5],["l",974,5],["l",974,59],["q",790,59,747,154],["q",704,250,704,570],["l",704,1086],["q",704,1423,774,1537],["q",839,1639,952,1712],["q",1065,1785,1195,1785],["q",1600,1785,1600,1299],["l",1600,570],["q",1600,263,1553,161],["q",1506,59,1322,59],["l",1322,5],["l",2126,5],["l",2126,59],["q",1942,59,1899,154],["q",1856,250,1856,569],["l",1856,1297],["q",1856,1633,1720,1742],["q",1585,1851,1318,1851],["q",894,1851,704,1572],["l",704,2880],["l",669,2880],["q",245,2812,145,2804],["l",145,2760],["q",346,2760,397,2691],["q",448,2623,448,2359],["l",448,559]]},"i":{"xoff":1088,"width":896,"height":2816,"hbx":128,"hby":2880,"path":[["m",448,616],["q",448,316,404,219],["q",361,123,175,123],["l",175,69],["l",962,69],["l",962,123],["q",784,123,744,213],["q",704,303,704,617],["l",704,1868],["l",665,1868],["q",251,1797,151,1789],["l",151,1744],["q",353,1744,400,1676],["q",448,1608,448,1349],["l",448,616],["m",430,2833],["q",384,2786,384,2718],["q",384,2651,430,2605],["q",476,2560,546,2560],["q",616,2560,664,2605],["q",712,2651,712,2718],["q",712,2786,664,2833],["q",616,2880,546,2880],["q",476,2880,430,2833]]},"j":{"xoff":1024,"width":1088,"height":3584,"hbx":-320,"hby":2880,"path":[["m",430,2833],["q",384,2786,384,2718],["q",384,2651,430,2605],["q",476,2560,545,2560],["q",615,2560,663,2605],["q",712,2651,712,2718],["q",712,2786,663,2833],["q",615,2880,545,2880],["q",476,2880,430,2833],["m",448,-52],["q",448,-396,396,-523],["q",344,-650,160,-650],["q",60,-650,8,-594],["q",-44,-539,-54,-471],["q",-65,-404,-100,-349],["q",-136,-294,-207,-294],["q",-320,-294,-320,-421],["q",-320,-515,-236,-580],["q",-152,-645,-57,-669],["q",37,-694,114,-694],["q",704,-694,704,91],["l",704,1872],["l",665,1872],["q",256,1802,153,1794],["l",153,1749],["q",354,1749,401,1675],["q",448,1602,448,1356],["l",448,-52]]},"k":{"xoff":1920,"width":2176,"height":2880,"hbx":64,"hby":2880,"path":[["m",384,558],["q",384,259,337,159],["q",290,59,106,59],["l",106,5],["l",911,5],["l",911,59],["q",726,59,683,153],["q",640,248,640,564],["l",640,787],["l",780,922],["l",1084,589],["q",1121,548,1172,490],["q",1223,433,1248,408],["q",1273,383,1304,347],["q",1335,311,1347,288],["q",1359,265,1367,237],["q",1376,210,1376,180],["q",1376,101,1331,80],["q",1286,59,1178,59],["l",1145,59],["l",1145,5],["l",2203,5],["l",2203,59],["l",2097,59],["q",1916,59,1657,350],["l",960,1098],["l",1285,1414],["q",1605,1721,1785,1721],["l",1818,1721],["l",1818,1787],["l",1018,1787],["l",1018,1721],["l",1051,1721],["q",1149,1721,1198,1675],["q",1248,1629,1248,1566],["q",1248,1460,1088,1309],["l",640,871],["l",640,2880],["l",605,2880],["q",185,2811,85,2803],["l",85,2762],["q",282,2762,333,2691],["q",384,2621,384,2362],["l",384,558]]},"l":{"xoff":1024,"width":896,"height":2880,"hbx":64,"hby":2880,"path":[["m",384,558],["q",384,259,337,159],["q",290,59,105,59],["l",105,5],["l",911,5],["l",911,59],["q",726,59,683,152],["q",640,245,640,558],["l",640,2880],["l",605,2880],["q",185,2809,85,2801],["l",85,2755],["q",286,2755,335,2686],["q",384,2618,384,2355],["l",384,558]]},"m":{"xoff":3392,"width":3200,"height":1920,"hbx":128,"hby":1856,"path":[["m",448,552],["q",448,256,401,157],["q",354,59,170,59],["l",170,-7],["l",974,-7],["l",974,59],["q",790,59,747,151],["q",704,243,704,551],["l",704,1048],["q",704,1376,773,1482],["q",839,1581,951,1651],["q",1064,1721,1194,1721],["q",1600,1721,1600,1253],["l",1600,551],["q",1600,256,1553,157],["q",1506,59,1322,59],["l",1322,-7],["l",2123,-7],["l",2123,59],["q",1938,59,1897,149],["q",1856,239,1856,551],["l",1856,1048],["q",1856,1363,1913,1466],["q",1971,1569,2092,1645],["q",2213,1721,2345,1721],["q",2752,1721,2752,1253],["l",2752,551],["q",2752,256,2705,157],["q",2658,59,2473,59],["l",2473,-7],["l",3279,-7],["l",3279,59],["q",3094,59,3051,151],["q",3008,243,3008,551],["l",3008,1253],["q",3008,1425,2967,1536],["q",2927,1647,2844,1698],["q",2761,1750,2672,1768],["q",2583,1787,2449,1787],["q",2202,1787,2066,1702],["q",1931,1618,1829,1478],["q",1788,1663,1658,1725],["q",1529,1787,1311,1787],["q",902,1787,704,1515],["l",684,1787],["l",657,1799],["q",397,1750,149,1721],["l",149,1675],["q",362,1675,405,1611],["q",448,1547,448,1264],["l",448,552]]},"n":{"xoff":2240,"width":2048,"height":1920,"hbx":128,"hby":1856,"path":[["m",448,552],["q",448,256,401,157],["q",354,59,170,59],["l",170,-7],["l",974,-7],["l",974,59],["q",790,59,747,151],["q",704,243,704,551],["l",704,1060],["q",704,1376,773,1482],["q",839,1581,951,1651],["q",1064,1721,1194,1721],["q",1600,1721,1600,1253],["l",1600,551],["q",1600,256,1553,157],["q",1506,59,1322,59],["l",1322,-7],["l",2126,-7],["l",2126,59],["q",1942,59,1899,151],["q",1856,243,1856,551],["l",1856,1253],["q",1856,1581,1721,1684],["q",1586,1787,1318,1787],["q",906,1787,704,1515],["l",684,1787],["l",657,1799],["q",397,1750,149,1721],["l",149,1675],["q",362,1675,405,1609],["q",448,1543,448,1268],["l",448,552]]},"o":{"xoff":2112,"width":1856,"height":1920,"hbx":128,"hby":1792,"path":[["m",402,1511],["q",128,1236,128,858],["q",128,480,402,204],["q",676,-71,1056,-71],["q",1436,-71,1710,204],["q",1984,480,1984,858],["q",1984,1236,1710,1511],["q",1436,1787,1056,1787],["q",676,1787,402,1511],["m",631,248],["q",456,501,456,858],["q",456,1215,631,1468],["q",807,1721,1056,1721],["q",1309,1721,1482,1470],["q",1656,1219,1656,858],["q",1656,497,1482,246],["q",1309,-5,1056,-5],["q",807,-5,631,248]]},"p":{"xoff":2240,"width":1984,"height":2688,"hbx":64,"hby":1856,"path":[["m",640,858],["q",640,1260,759,1490],["q",878,1721,1116,1721],["q",1411,1721,1565,1478],["q",1720,1236,1720,858],["q",1720,497,1567,246],["q",1415,-5,1116,-5],["q",833,-5,736,198],["q",640,402,640,858],["m",657,1824],["l",615,1824],["q",192,1732,89,1721],["l",89,1675],["q",290,1675,337,1607],["q",384,1540,384,1281],["l",384,-286],["q",384,-585,335,-681],["q",286,-778,81,-778],["l",81,-832],["l",940,-832],["l",940,-778],["q",743,-778,700,-621],["q",657,-464,657,148],["q",763,37,872,-17],["q",981,-71,1170,-71],["q",1593,-71,1820,194],["q",2048,460,2048,858],["q",2048,1240,1796,1513],["q",1544,1787,1165,1787],["q",846,1787,657,1551],["l",657,1824]]},"q":{"xoff":2176,"width":1984,"height":2688,"hbx":128,"hby":1856,"path":[["m",1565,1631],["q",1524,1631,1460,1670],["q",1397,1709,1284,1748],["q",1171,1787,1007,1787],["q",629,1787,378,1518],["q",128,1249,128,874],["q",128,487,380,208],["q",633,-71,1043,-71],["q",1335,-71,1519,133],["q",1519,-483,1476,-630],["q",1433,-778,1236,-778],["l",1236,-832],["l",2095,-832],["l",2095,-778],["q",1890,-778,1841,-680],["q",1792,-583,1792,-281],["l",1792,1824],["l",1734,1824],["q",1697,1631,1565,1631],["m",1536,874],["q",1536,647,1519,502],["q",1503,358,1456,233],["q",1409,109,1312,52],["q",1215,-5,1060,-5],["q",761,-5,608,255],["q",456,516,456,874],["q",456,1245,610,1483],["q",765,1721,1060,1721],["q",1343,1721,1439,1511],["q",1536,1301,1536,874]]},"r":{"xoff":1472,"width":1408,"height":1920,"hbx":64,"hby":1856,"path":[["m",621,1803],["l",593,1815],["q",333,1765,85,1736],["l",85,1689],["q",298,1689,341,1622],["q",384,1556,384,1278],["l",384,556],["q",384,258,337,158],["q",290,59,105,59],["l",105,-7],["l",918,-7],["l",918,59],["q",728,59,684,151],["q",640,244,640,555],["l",640,1160],["q",640,1383,700,1479],["q",808,1664,969,1664],["q",1044,1664,1092,1629],["q",1141,1594,1160,1550],["q",1179,1507,1214,1471],["q",1250,1436,1304,1436],["q",1364,1436,1402,1482],["q",1440,1528,1440,1586],["q",1440,1665,1364,1723],["q",1288,1782,1158,1782],["q",834,1782,640,1527],["l",621,1803]]},"s":{"xoff":1536,"width":1152,"height":1920,"hbx":192,"hby":1792,"path":[["m",1088,289],["q",1088,149,998,72],["q",909,-5,780,-5],["q",629,-5,514,67],["q",400,140,343,241],["q",287,343,262,419],["q",237,496,233,533],["l",224,533],["l",224,-42],["l",281,-42],["q",281,-17,309,3],["q",338,24,387,24],["q",436,24,543,-23],["q",650,-71,781,-71],["q",1048,-71,1196,90],["q",1344,252,1344,434],["q",1344,616,1251,742],["q",1159,868,1028,934],["q",897,1000,765,1060],["q",634,1121,541,1216],["q",448,1311,448,1447],["q",448,1539,478,1599],["q",509,1659,556,1681],["q",603,1704,635,1712],["q",668,1721,698,1721],["q",865,1721,976,1545],["q",1088,1369,1088,1257],["l",1152,1257],["l",1152,1787],["l",1088,1787],["q",1088,1688,1020,1688],["q",997,1688,889,1737],["q",782,1787,698,1787],["q",543,1787,399,1664],["q",256,1542,256,1310],["q",256,1136,342,1015],["q",429,895,549,830],["q",669,766,792,704],["q",915,642,1001,540],["q",1088,439,1088,289]]},"t":{"xoff":1280,"width":1152,"height":2432,"hbx":192,"hby":2304,"path":[["m",376,1657],["l",192,1657],["l",192,1715],["q",424,1748,521,1889],["q",618,2030,658,2255],["l",704,2255],["l",704,1723],["l",1216,1723],["l",1216,1657],["l",704,1657],["l",704,518],["q",704,220,758,102],["q",813,-15,965,-15],["q",1173,-15,1274,153],["l",1306,132],["l",1285,94],["q",1264,60,1237,37],["q",1211,14,1161,-16],["q",1112,-47,1027,-64],["q",942,-81,830,-81],["q",610,-81,493,23],["q",376,127,376,342],["l",376,1657]]},"u":{"xoff":2240,"width":2048,"height":1856,"hbx":64,"hby":1728,"path":[["m",640,1723],["l",93,1723],["l",93,1657],["q",285,1657,334,1563],["q",384,1469,384,1166],["l",384,474],["q",384,294,432,177],["q",481,60,577,11],["q",674,-38,763,-54],["q",853,-71,990,-71],["q",1378,-71,1536,159],["l",1551,-54],["l",1579,-67],["q",1839,-46,2087,-17],["l",2087,28],["q",1878,28,1835,90],["q",1792,152,1792,433],["l",1792,1723],["l",1270,1723],["l",1270,1657],["q",1454,1657,1495,1567],["q",1536,1478,1536,1166],["l",1536,622],["q",1536,270,1466,179],["q",1323,-5,1021,-5],["q",849,-5,744,113],["q",640,231,640,477],["l",640,1723]]},"v":{"xoff":1856,"width":1984,"height":1856,"hbx":-64,"hby":1728,"path":[["m",-11,1723],["l",-11,1657],["l",22,1657],["q",91,1657,142,1638],["q",194,1620,228,1570],["q",262,1520,278,1487],["q",295,1454,328,1374],["l",909,-71],["l",942,-71],["l",1428,1075],["q",1436,1096,1462,1160],["q",1489,1225,1507,1266],["q",1526,1308,1559,1374],["q",1592,1441,1620,1484],["q",1649,1528,1685,1572],["q",1722,1616,1763,1636],["q",1804,1657,1849,1657],["l",1869,1657],["l",1869,1723],["l",1244,1723],["l",1244,1657],["l",1264,1657],["q",1354,1657,1413,1594],["q",1472,1532,1472,1429],["q",1472,1329,1362,1075],["l",1052,336],["l",754,1084],["q",640,1366,640,1470],["q",640,1549,709,1603],["q",779,1657,873,1657],["l",901,1657],["l",901,1723],["l",-11,1723]]},"w":{"xoff":2688,"width":2752,"height":1856,"hbx":-64,"hby":1728,"path":[["m",1493,1723],["l",1440,1723],["l",1022,407],["l",754,1084],["q",640,1366,640,1470],["q",640,1549,709,1603],["q",779,1657,872,1657],["l",900,1657],["l",900,1723],["l",-11,1723],["l",-11,1657],["l",22,1657],["q",91,1657,142,1636],["q",194,1616,228,1570],["q",262,1524,280,1484],["q",299,1445,328,1374],["l",900,-71],["l",928,-71],["l",1350,1229],["l",1773,-71],["l",1801,-71],["l",2233,1075],["q",2449,1657,2649,1657],["l",2669,1657],["l",2669,1723],["l",2045,1723],["l",2045,1657],["l",2066,1657],["q",2151,1657,2211,1596],["q",2272,1536,2272,1440],["q",2272,1345,2166,1076],["l",1915,407],["l",1493,1723]]},"x":{"xoff":1856,"width":1984,"height":1792,"hbx":-64,"hby":1728,"path":[["m",512,249],["q",512,354,633,523],["l",820,783],["l",1072,430],["q",1184,269,1184,188],["q",1184,59,1016,59],["l",984,59],["l",984,-7],["l",1907,-7],["l",1907,59],["l",1882,59],["q",1833,59,1786,75],["q",1739,91,1706,107],["q",1673,124,1636,162],["q",1600,200,1585,220],["q",1571,240,1538,287],["q",1505,334,1497,342],["l",988,1014],["l",1259,1337],["q",1526,1657,1727,1657],["l",1759,1657],["l",1759,1723],["l",1040,1723],["l",1040,1657],["l",1072,1657],["q",1173,1657,1226,1613],["q",1280,1569,1280,1508],["q",1280,1419,1133,1248],["l",964,1050],["l",736,1358],["q",640,1480,640,1540],["q",640,1588,694,1622],["q",748,1657,812,1657],["l",844,1657],["l",844,1723],["l",4,1723],["l",4,1657],["l",41,1657],["q",108,1657,171,1619],["q",235,1581,264,1550],["q",293,1520,349,1437],["q",405,1354,409,1350],["l",796,816],["l",466,379],["q",223,59,8,59],["l",-24,59],["l",-24,-7],["l",788,-7],["l",788,59],["l",754,59],["q",617,59,564,103],["q",512,147,512,249]]},"y":{"xoff":1920,"width":1984,"height":2560,"hbx":0,"hby":1728,"path":[["m",1119,299],["l",782,1104],["q",672,1377,672,1477],["q",672,1553,737,1605],["q",802,1657,890,1657],["l",917,1657],["l",917,1723],["l",11,1723],["l",11,1657],["l",43,1657],["q",112,1657,160,1637],["q",209,1617,246,1571],["q",283,1525,301,1491],["q",319,1457,347,1384],["l",928,6],["q",928,-166,823,-383],["q",791,-456,713,-516],["q",636,-576,559,-576],["q",532,-576,485,-559],["q",439,-543,398,-543],["q",256,-543,256,-670],["q",256,-728,307,-780],["q",359,-832,445,-832],["q",715,-832,903,-381],["l",1523,1089],["q",1765,1657,1945,1657],["l",1965,1657],["l",1965,1723],["l",1335,1723],["l",1335,1657],["l",1355,1657],["q",1447,1657,1507,1597],["q",1568,1537,1568,1437],["q",1568,1356,1460,1096],["l",1119,299]]},"z":{"xoff":1920,"width":1664,"height":1792,"hbx":128,"hby":1728,"path":[["m",507,59],["l",1664,1668],["l",1664,1723],["l",299,1723],["l",246,1214],["l",291,1214],["q",356,1468,468,1562],["q",581,1657,845,1657],["l",1289,1657],["l",128,48],["l",128,-7],["l",1726,-7],["l",1783,582],["l",1738,582],["q",1672,260,1507,159],["q",1342,59,820,59],["l",507,59]]},"~":{"xoff":1408,"width":1216,"height":384,"hbx":64,"hby":1088,"path":[["m",1280,1068],["q",1280,931,1178,817],["q",1077,704,937,704],["q",814,704,628,800],["q",443,896,336,896],["q",272,896,224,852],["q",177,809,161,770],["l",145,727],["l",64,727],["q",64,886,172,987],["q",280,1088,397,1088],["q",515,1088,702,992],["q",890,896,964,896],["q",1090,896,1153,950],["q",1216,1004,1216,1078],["l",1280,1068]]}},"exporter":"SimpleJson","version":"0.0.2"};

},{}],11:[function(require,module,exports){
var util = require('fontpath-util');
var Matrix3 = require('vecmath').Matrix3;
var Vector3 = require('vecmath').Vector3;

var tmpVec = new Vector3();

/**
 * Prepares a Matrix3 from the given font and glyph info, which
 * is expected to be in the form of fontpath output, i.e.:
 *
 * { resolution, size, units_per_EM }
 *
 * You can transform a 2D pixel-space point by this matrix and
 * it will line the glyph up to match Canvas fillText rendering
 * (i.e. lower-left origin for text rendering). 
 *
 * If no `outMatrix` is specified, a new Matrix3 will be created.
 * 
 * @param  {Number} font      the font object which defines resolution, size, and units_per_em
 * @param  {Number} glyph     the glyph object from fontpath output
 * @param  {Number} fontSize  the desired font size, or defaults to font.size
 * @param  {Number} x         the desired x position in pixel space, defaults to 0
 * @param  {Number} y         the desired y position in pixel space, defaults to 0
 * @param  {Matrix3} outMatrix the output matrix to use
 * @return {Matrix3}           the output matrix
 */
module.exports.toGlyphMatrix3 = function(font, glyph, fontSize, x, y, outMatrix) {
	fontSize = fontSize||fontSize===0 ? fontSize : font.size;
	x = x||0;
	y = y||0;

	var pxSize = util.pointsToPixels(fontSize, font.resolution);

	var pointScale = (32/font.size) * pxSize / font.units_per_EM;

	if (!outMatrix)
		outMatrix = new Matrix3();
	else
		outMatrix.idt();
	outMatrix.translate( tmpVec.set(x, y) );
	outMatrix.scale( tmpVec.set(pointScale, -pointScale) );
	outMatrix.translate( tmpVec.set(-glyph.hbx, 0) );
	return outMatrix;
}
},{"fontpath-util":12,"vecmath":32}],12:[function(require,module,exports){
module.exports.pointsToPixels = function(pointSize, resolution) {
	resolution = typeof resolution === "number" ? resolution : 72;
	return pointSize * resolution / 72;
};

module.exports.coordToPixel = function(coord, pixelSize, emSize) {
	emSize = typeof emSize === "number" ? emSize : 2048;
	return coord * pixelSize / emSize;
};
},{}],13:[function(require,module,exports){
module.exports.isClockwise = function(points) {
    var sum = 0;
    for (var i=0; i<points.length; i++) {
        var o = i===points.length-1 ? points[0] : points[i+1];
        sum += (o.x - points[i].x) * (o.y + points[i].y);
    }
    return sum > 0;
}

module.exports.pointInPoly = function(points, test) {
    //http://stackoverflow.com/a/2922778
    var c = 0,
        nvert = points.length, 
        i=0, j=nvert-1, 
        testx = test.x,
        testy = test.y;

    for ( ; i < nvert; j = i++) {
        if ( ((points[i].y>testy) != (points[j].y>testy)) 
                && (testx < (points[j].x-points[i].x) 
                    * (testy-points[i].y) / (points[j].y-points[i].x) + points[i].x) )
            c = !c;
    }
    return c;
}

module.exports.indexOfPointInList = function(other, list) {
    for (var i=0; i<list.length; i++) {
        var p = list[i];
        if (p.x == other.x && p.y == other.y)
            return i;
    }
    return -1;
}

module.exports.isCollinear = function(a, b, c) {
    var r = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) ;
    var eps = 0.0000001;

    if (Math.abs(r) < eps)
        return true;

    //poly2tri also complains about this:
    if ((a.x===b.x && b.x===c.x) || (a.y===b.y && b.y===c.y))
        return true;

    return false;
}

module.exports.getBounds = function(contour) {
    var minX = Number.MAX_VALUE,
        minY = Number.MAX_VALUE,
        maxX = -Number.MAX_VALUE,
        maxY = -Number.MAX_VALUE;
    for (var i=0; i<contour.length; i++) {
        var v = contour[i];
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
    }
    return {
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY
    };
}
},{}],14:[function(require,module,exports){
module.exports={"version": "1.3.5"}
},{}],15:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint maxcomplexity:11 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */


// -------------------------------------------------------------------------Node

/**
 * Advancing front node
 * @constructor
 * @private
 * @struct
 * @param {!XY} p - Point
 * @param {Triangle=} t triangle (optional)
 */
var Node = function(p, t) {
    /** @type {XY} */
    this.point = p;

    /** @type {Triangle|null} */
    this.triangle = t || null;

    /** @type {Node|null} */
    this.next = null;
    /** @type {Node|null} */
    this.prev = null;

    /** @type {number} */
    this.value = p.x;
};

// ---------------------------------------------------------------AdvancingFront
/**
 * @constructor
 * @private
 * @struct
 * @param {Node} head
 * @param {Node} tail
 */
var AdvancingFront = function(head, tail) {
    /** @type {Node} */
    this.head_ = head;
    /** @type {Node} */
    this.tail_ = tail;
    /** @type {Node} */
    this.search_node_ = head;
};

/** @return {Node} */
AdvancingFront.prototype.head = function() {
    return this.head_;
};

/** @param {Node} node */
AdvancingFront.prototype.setHead = function(node) {
    this.head_ = node;
};

/** @return {Node} */
AdvancingFront.prototype.tail = function() {
    return this.tail_;
};

/** @param {Node} node */
AdvancingFront.prototype.setTail = function(node) {
    this.tail_ = node;
};

/** @return {Node} */
AdvancingFront.prototype.search = function() {
    return this.search_node_;
};

/** @param {Node} node */
AdvancingFront.prototype.setSearch = function(node) {
    this.search_node_ = node;
};

/** @return {Node} */
AdvancingFront.prototype.findSearchNode = function(/*x*/) {
    // TODO: implement BST index
    return this.search_node_;
};

/**
 * @param {number} x value
 * @return {Node}
 */
AdvancingFront.prototype.locateNode = function(x) {
    var node = this.search_node_;

    /* jshint boss:true */
    if (x < node.value) {
        while (node = node.prev) {
            if (x >= node.value) {
                this.search_node_ = node;
                return node;
            }
        }
    } else {
        while (node = node.next) {
            if (x < node.value) {
                this.search_node_ = node.prev;
                return node.prev;
            }
        }
    }
    return null;
};

/**
 * @param {!XY} point - Point
 * @return {Node}
 */
AdvancingFront.prototype.locatePoint = function(point) {
    var px = point.x;
    var node = this.findSearchNode(px);
    var nx = node.point.x;

    if (px === nx) {
        // Here we are comparing point references, not values
        if (point !== node.point) {
            // We might have two nodes with same x value for a short time
            if (point === node.prev.point) {
                node = node.prev;
            } else if (point === node.next.point) {
                node = node.next;
            } else {
                throw new Error('poly2tri Invalid AdvancingFront.locatePoint() call');
            }
        }
    } else if (px < nx) {
        /* jshint boss:true */
        while (node = node.prev) {
            if (point === node.point) {
                break;
            }
        }
    } else {
        while (node = node.next) {
            if (point === node.point) {
                break;
            }
        }
    }

    if (node) {
        this.search_node_ = node;
    }
    return node;
};


// ----------------------------------------------------------------------Exports

module.exports = AdvancingFront;
module.exports.Node = Node;


},{}],16:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 *
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 *
 * All rights reserved.
 *
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";

/*
 * Function added in the JavaScript version (was not present in the c++ version)
 */

/**
 * assert and throw an exception.
 *
 * @private
 * @param {boolean} condition   the condition which is asserted
 * @param {string} message      the message which is display is condition is falsy
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assert Failed");
    }
}
module.exports = assert;



},{}],17:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var xy = require('./xy');

// ------------------------------------------------------------------------Point
/**
 * Construct a point
 * @example
 *      var point = new poly2tri.Point(150, 150);
 * @public
 * @constructor
 * @struct
 * @param {number=} x    coordinate (0 if undefined)
 * @param {number=} y    coordinate (0 if undefined)
 */
var Point = function(x, y) {
    /**
     * @type {number}
     * @expose
     */
    this.x = +x || 0;
    /**
     * @type {number}
     * @expose
     */
    this.y = +y || 0;

    // All extra fields added to Point are prefixed with _p2t_
    // to avoid collisions if custom Point class is used.

    /**
     * The edges this point constitutes an upper ending point
     * @private
     * @type {Array.<Edge>}
     */
    this._p2t_edge_list = null;
};

/**
 * For pretty printing
 * @example
 *      "p=" + new poly2tri.Point(5,42)
 *      // → "p=(5;42)"
 * @returns {string} <code>"(x;y)"</code>
 */
Point.prototype.toString = function() {
    return xy.toStringBase(this);
};

/**
 * JSON output, only coordinates
 * @example
 *      JSON.stringify(new poly2tri.Point(1,2))
 *      // → '{"x":1,"y":2}'
 */
Point.prototype.toJSON = function() {
    return { x: this.x, y: this.y };
};

/**
 * Creates a copy of this Point object.
 * @return {Point} new cloned point
 */
Point.prototype.clone = function() {
    return new Point(this.x, this.y);
};

/**
 * Set this Point instance to the origo. <code>(0; 0)</code>
 * @return {Point} this (for chaining)
 */
Point.prototype.set_zero = function() {
    this.x = 0.0;
    this.y = 0.0;
    return this; // for chaining
};

/**
 * Set the coordinates of this instance.
 * @param {number} x   coordinate
 * @param {number} y   coordinate
 * @return {Point} this (for chaining)
 */
Point.prototype.set = function(x, y) {
    this.x = +x || 0;
    this.y = +y || 0;
    return this; // for chaining
};

/**
 * Negate this Point instance. (component-wise)
 * @return {Point} this (for chaining)
 */
Point.prototype.negate = function() {
    this.x = -this.x;
    this.y = -this.y;
    return this; // for chaining
};

/**
 * Add another Point object to this instance. (component-wise)
 * @param {!Point} n - Point object.
 * @return {Point} this (for chaining)
 */
Point.prototype.add = function(n) {
    this.x += n.x;
    this.y += n.y;
    return this; // for chaining
};

/**
 * Subtract this Point instance with another point given. (component-wise)
 * @param {!Point} n - Point object.
 * @return {Point} this (for chaining)
 */
Point.prototype.sub = function(n) {
    this.x -= n.x;
    this.y -= n.y;
    return this; // for chaining
};

/**
 * Multiply this Point instance by a scalar. (component-wise)
 * @param {number} s   scalar.
 * @return {Point} this (for chaining)
 */
Point.prototype.mul = function(s) {
    this.x *= s;
    this.y *= s;
    return this; // for chaining
};

/**
 * Return the distance of this Point instance from the origo.
 * @return {number} distance
 */
Point.prototype.length = function() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
};

/**
 * Normalize this Point instance (as a vector).
 * @return {number} The original distance of this instance from the origo.
 */
Point.prototype.normalize = function() {
    var len = this.length();
    this.x /= len;
    this.y /= len;
    return len;
};

/**
 * Test this Point object with another for equality.
 * @param {!XY} p - any "Point like" object with {x,y}
 * @return {boolean} <code>true</code> if same x and y coordinates, <code>false</code> otherwise.
 */
Point.prototype.equals = function(p) {
    return this.x === p.x && this.y === p.y;
};


// -----------------------------------------------------Point ("static" methods)

/**
 * Negate a point component-wise and return the result as a new Point object.
 * @param {!XY} p - any "Point like" object with {x,y}
 * @return {Point} the resulting Point object.
 */
Point.negate = function(p) {
    return new Point(-p.x, -p.y);
};

/**
 * Add two points component-wise and return the result as a new Point object.
 * @param {!XY} a - any "Point like" object with {x,y}
 * @param {!XY} b - any "Point like" object with {x,y}
 * @return {Point} the resulting Point object.
 */
Point.add = function(a, b) {
    return new Point(a.x + b.x, a.y + b.y);
};

/**
 * Subtract two points component-wise and return the result as a new Point object.
 * @param {!XY} a - any "Point like" object with {x,y}
 * @param {!XY} b - any "Point like" object with {x,y}
 * @return {Point} the resulting Point object.
 */
Point.sub = function(a, b) {
    return new Point(a.x - b.x, a.y - b.y);
};

/**
 * Multiply a point by a scalar and return the result as a new Point object.
 * @param {number} s - the scalar
 * @param {!XY} p - any "Point like" object with {x,y}
 * @return {Point} the resulting Point object.
 */
Point.mul = function(s, p) {
    return new Point(s * p.x, s * p.y);
};

/**
 * Perform the cross product on either two points (this produces a scalar)
 * or a point and a scalar (this produces a point).
 * This function requires two parameters, either may be a Point object or a
 * number.
 * @param  {XY|number} a - Point object or scalar.
 * @param  {XY|number} b - Point object or scalar.
 * @return {Point|number} a Point object or a number, depending on the parameters.
 */
Point.cross = function(a, b) {
    if (typeof(a) === 'number') {
        if (typeof(b) === 'number') {
            return a * b;
        } else {
            return new Point(-a * b.y, a * b.x);
        }
    } else {
        if (typeof(b) === 'number') {
            return new Point(b * a.y, -b * a.x);
        } else {
            return a.x * b.y - a.y * b.x;
        }
    }
};


// -----------------------------------------------------------------"Point-Like"
/*
 * The following functions operate on "Point" or any "Point like" object 
 * with {x,y} (duck typing).
 */

Point.toString = xy.toString;
Point.compare = xy.compare;
Point.cmp = xy.compare; // backward compatibility
Point.equals = xy.equals;

/**
 * Peform the dot product on two vectors.
 * @public
 * @param {!XY} a - any "Point like" object with {x,y}
 * @param {!XY} b - any "Point like" object with {x,y}
 * @return {number} The dot product
 */
Point.dot = function(a, b) {
    return a.x * b.x + a.y * b.y;
};


// ---------------------------------------------------------Exports (public API)

module.exports = Point;

},{"./xy":24}],18:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";

/*
 * Class added in the JavaScript version (was not present in the c++ version)
 */

var xy = require('./xy');

/**
 * Custom exception class to indicate invalid Point values
 * @constructor
 * @public
 * @extends Error
 * @struct
 * @param {string=} message - error message
 * @param {Array.<XY>=} points - invalid points
 */
var PointError = function(message, points) {
    this.name = "PointError";
    /**
     * Invalid points
     * @public
     * @type {Array.<XY>}
     */
    this.points = points = points || [];
    /**
     * Error message
     * @public
     * @type {string}
     */
    this.message = message || "Invalid Points!";
    for (var i = 0; i < points.length; i++) {
        this.message += " " + xy.toString(points[i]);
    }
};
PointError.prototype = new Error();
PointError.prototype.constructor = PointError;


module.exports = PointError;

},{"./xy":24}],19:[function(require,module,exports){
(function (global){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 * * Neither the name of Poly2Tri nor the names of its contributors may be
 *   used to endorse or promote products derived from this software without specific
 *   prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

"use strict";

/**
 * Public API for poly2tri.js
 * @module poly2tri
 */


/**
 * If you are not using a module system (e.g. CommonJS, RequireJS), you can access this library
 * as a global variable <code>poly2tri</code> i.e. <code>window.poly2tri</code> in a browser.
 * @name poly2tri
 * @global
 * @public
 * @type {module:poly2tri}
 */
var previousPoly2tri = global.poly2tri;
/**
 * For Browser + &lt;script&gt; :
 * reverts the {@linkcode poly2tri} global object to its previous value,
 * and returns a reference to the instance called.
 *
 * @example
 *              var p = poly2tri.noConflict();
 * @public
 * @return {module:poly2tri} instance called
 */
// (this feature is not automatically provided by browserify).
exports.noConflict = function() {
    global.poly2tri = previousPoly2tri;
    return exports;
};

/**
 * poly2tri library version
 * @public
 * @const {string}
 */
exports.VERSION = require('../dist/version.json').version;

/**
 * Exports the {@linkcode PointError} class.
 * @public
 * @typedef {PointError} module:poly2tri.PointError
 * @function
 */
exports.PointError = require('./pointerror');
/**
 * Exports the {@linkcode Point} class.
 * @public
 * @typedef {Point} module:poly2tri.Point
 * @function
 */
exports.Point = require('./point');
/**
 * Exports the {@linkcode Triangle} class.
 * @public
 * @typedef {Triangle} module:poly2tri.Triangle
 * @function
 */
exports.Triangle = require('./triangle');
/**
 * Exports the {@linkcode SweepContext} class.
 * @public
 * @typedef {SweepContext} module:poly2tri.SweepContext
 * @function
 */
exports.SweepContext = require('./sweepcontext');


// Backward compatibility
var sweep = require('./sweep');
/**
 * @function
 * @deprecated use {@linkcode SweepContext#triangulate} instead
 */
exports.triangulate = sweep.triangulate;
/**
 * @deprecated use {@linkcode SweepContext#triangulate} instead
 * @property {function} Triangulate - use {@linkcode SweepContext#triangulate} instead
 */
exports.sweep = {Triangulate: sweep.triangulate};

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../dist/version.json":14,"./point":17,"./pointerror":18,"./sweep":20,"./sweepcontext":21,"./triangle":22}],20:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint latedef:nofunc, maxcomplexity:9 */

"use strict";

/**
 * This 'Sweep' module is present in order to keep this JavaScript version
 * as close as possible to the reference C++ version, even though almost all
 * functions could be declared as methods on the {@linkcode module:sweepcontext~SweepContext} object.
 * @module
 * @private
 */

/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var assert = require('./assert');
var PointError = require('./pointerror');
var Triangle = require('./triangle');
var Node = require('./advancingfront').Node;


// ------------------------------------------------------------------------utils

var utils = require('./utils');

/** @const */
var EPSILON = utils.EPSILON;

/** @const */
var Orientation = utils.Orientation;
/** @const */
var orient2d = utils.orient2d;
/** @const */
var inScanArea = utils.inScanArea;
/** @const */
var isAngleObtuse = utils.isAngleObtuse;


// ------------------------------------------------------------------------Sweep

/**
 * Triangulate the polygon with holes and Steiner points.
 * Do this AFTER you've added the polyline, holes, and Steiner points
 * @private
 * @param {!SweepContext} tcx - SweepContext object
 */
function triangulate(tcx) {
    tcx.initTriangulation();
    tcx.createAdvancingFront();
    // Sweep points; build mesh
    sweepPoints(tcx);
    // Clean up
    finalizationPolygon(tcx);
}

/**
 * Start sweeping the Y-sorted point set from bottom to top
 * @param {!SweepContext} tcx - SweepContext object
 */
function sweepPoints(tcx) {
    var i, len = tcx.pointCount();
    for (i = 1; i < len; ++i) {
        var point = tcx.getPoint(i);
        var node = pointEvent(tcx, point);
        var edges = point._p2t_edge_list;
        for (var j = 0; edges && j < edges.length; ++j) {
            edgeEventByEdge(tcx, edges[j], node);
        }
    }
}

/**
 * @param {!SweepContext} tcx - SweepContext object
 */
function finalizationPolygon(tcx) {
    // Get an Internal triangle to start with
    var t = tcx.front().head().next.triangle;
    var p = tcx.front().head().next.point;
    while (!t.getConstrainedEdgeCW(p)) {
        t = t.neighborCCW(p);
    }

    // Collect interior triangles constrained by edges
    tcx.meshClean(t);
}

/**
 * Find closes node to the left of the new point and
 * create a new triangle. If needed new holes and basins
 * will be filled to.
 * @param {!SweepContext} tcx - SweepContext object
 * @param {!XY} point   Point
 */
function pointEvent(tcx, point) {
    var node = tcx.locateNode(point);
    var new_node = newFrontTriangle(tcx, point, node);

    // Only need to check +epsilon since point never have smaller
    // x value than node due to how we fetch nodes from the front
    if (point.x <= node.point.x + (EPSILON)) {
        fill(tcx, node);
    }

    //tcx.AddNode(new_node);

    fillAdvancingFront(tcx, new_node);
    return new_node;
}

function edgeEventByEdge(tcx, edge, node) {
    tcx.edge_event.constrained_edge = edge;
    tcx.edge_event.right = (edge.p.x > edge.q.x);

    if (isEdgeSideOfTriangle(node.triangle, edge.p, edge.q)) {
        return;
    }

    // For now we will do all needed filling
    // TODO: integrate with flip process might give some better performance
    //       but for now this avoid the issue with cases that needs both flips and fills
    fillEdgeEvent(tcx, edge, node);
    edgeEventByPoints(tcx, edge.p, edge.q, node.triangle, edge.q);
}

function edgeEventByPoints(tcx, ep, eq, triangle, point) {
    if (isEdgeSideOfTriangle(triangle, ep, eq)) {
        return;
    }

    var p1 = triangle.pointCCW(point);
    var o1 = orient2d(eq, p1, ep);
    if (o1 === Orientation.COLLINEAR) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision 09880a869095 dated March 8, 2011)
        throw new PointError('poly2tri EdgeEvent: Collinear not supported!', [eq, p1, ep]);
    }

    var p2 = triangle.pointCW(point);
    var o2 = orient2d(eq, p2, ep);
    if (o2 === Orientation.COLLINEAR) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision 09880a869095 dated March 8, 2011)
        throw new PointError('poly2tri EdgeEvent: Collinear not supported!', [eq, p2, ep]);
    }

    if (o1 === o2) {
        // Need to decide if we are rotating CW or CCW to get to a triangle
        // that will cross edge
        if (o1 === Orientation.CW) {
            triangle = triangle.neighborCCW(point);
        } else {
            triangle = triangle.neighborCW(point);
        }
        edgeEventByPoints(tcx, ep, eq, triangle, point);
    } else {
        // This triangle crosses constraint so lets flippin start!
        flipEdgeEvent(tcx, ep, eq, triangle, point);
    }
}

function isEdgeSideOfTriangle(triangle, ep, eq) {
    var index = triangle.edgeIndex(ep, eq);
    if (index !== -1) {
        triangle.markConstrainedEdgeByIndex(index);
        var t = triangle.getNeighbor(index);
        if (t) {
            t.markConstrainedEdgeByPoints(ep, eq);
        }
        return true;
    }
    return false;
}

/**
 * Creates a new front triangle and legalize it
 * @param {!SweepContext} tcx - SweepContext object
 */
function newFrontTriangle(tcx, point, node) {
    var triangle = new Triangle(point, node.point, node.next.point);

    triangle.markNeighbor(node.triangle);
    tcx.addToMap(triangle);

    var new_node = new Node(point);
    new_node.next = node.next;
    new_node.prev = node;
    node.next.prev = new_node;
    node.next = new_node;

    if (!legalize(tcx, triangle)) {
        tcx.mapTriangleToNodes(triangle);
    }

    return new_node;
}

/**
 * Adds a triangle to the advancing front to fill a hole.
 * @param {!SweepContext} tcx - SweepContext object
 * @param node - middle node, that is the bottom of the hole
 */
function fill(tcx, node) {
    var triangle = new Triangle(node.prev.point, node.point, node.next.point);

    // TODO: should copy the constrained_edge value from neighbor triangles
    //       for now constrained_edge values are copied during the legalize
    triangle.markNeighbor(node.prev.triangle);
    triangle.markNeighbor(node.triangle);

    tcx.addToMap(triangle);

    // Update the advancing front
    node.prev.next = node.next;
    node.next.prev = node.prev;


    // If it was legalized the triangle has already been mapped
    if (!legalize(tcx, triangle)) {
        tcx.mapTriangleToNodes(triangle);
    }

    //tcx.removeNode(node);
}

/**
 * Fills holes in the Advancing Front
 * @param {!SweepContext} tcx - SweepContext object
 */
function fillAdvancingFront(tcx, n) {
    // Fill right holes
    var node = n.next;
    while (node.next) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision acf81f1f1764 dated April 7, 2012)
        if (isAngleObtuse(node.point, node.next.point, node.prev.point)) {
            break;
        }
        fill(tcx, node);
        node = node.next;
    }

    // Fill left holes
    node = n.prev;
    while (node.prev) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision acf81f1f1764 dated April 7, 2012)
        if (isAngleObtuse(node.point, node.next.point, node.prev.point)) {
            break;
        }
        fill(tcx, node);
        node = node.prev;
    }

    // Fill right basins
    if (n.next && n.next.next) {
        if (isBasinAngleRight(n)) {
            fillBasin(tcx, n);
        }
    }
}

/**
 * The basin angle is decided against the horizontal line [1,0].
 * @param {Node} node
 * @return {boolean} true if angle < 3*π/4
 */
function isBasinAngleRight(node) {
    var ax = node.point.x - node.next.next.point.x;
    var ay = node.point.y - node.next.next.point.y;
    assert(ay >= 0, "unordered y");
    return (ax >= 0 || Math.abs(ax) < ay);
}

/**
 * Returns true if triangle was legalized
 * @param {!SweepContext} tcx - SweepContext object
 * @return {boolean}
 */
function legalize(tcx, t) {
    // To legalize a triangle we start by finding if any of the three edges
    // violate the Delaunay condition
    for (var i = 0; i < 3; ++i) {
        if (t.delaunay_edge[i]) {
            continue;
        }
        var ot = t.getNeighbor(i);
        if (ot) {
            var p = t.getPoint(i);
            var op = ot.oppositePoint(t, p);
            var oi = ot.index(op);

            // If this is a Constrained Edge or a Delaunay Edge(only during recursive legalization)
            // then we should not try to legalize
            if (ot.constrained_edge[oi] || ot.delaunay_edge[oi]) {
                t.constrained_edge[i] = ot.constrained_edge[oi];
                continue;
            }

            var inside = inCircle(p, t.pointCCW(p), t.pointCW(p), op);
            if (inside) {
                // Lets mark this shared edge as Delaunay
                t.delaunay_edge[i] = true;
                ot.delaunay_edge[oi] = true;

                // Lets rotate shared edge one vertex CW to legalize it
                rotateTrianglePair(t, p, ot, op);

                // We now got one valid Delaunay Edge shared by two triangles
                // This gives us 4 new edges to check for Delaunay

                // Make sure that triangle to node mapping is done only one time for a specific triangle
                var not_legalized = !legalize(tcx, t);
                if (not_legalized) {
                    tcx.mapTriangleToNodes(t);
                }

                not_legalized = !legalize(tcx, ot);
                if (not_legalized) {
                    tcx.mapTriangleToNodes(ot);
                }
                // Reset the Delaunay edges, since they only are valid Delaunay edges
                // until we add a new triangle or point.
                // XXX: need to think about this. Can these edges be tried after we
                //      return to previous recursive level?
                t.delaunay_edge[i] = false;
                ot.delaunay_edge[oi] = false;

                // If triangle have been legalized no need to check the other edges since
                // the recursive legalization will handles those so we can end here.
                return true;
            }
        }
    }
    return false;
}

/**
 * <b>Requirement</b>:<br>
 * 1. a,b and c form a triangle.<br>
 * 2. a and d is know to be on opposite side of bc<br>
 * <pre>
 *                a
 *                +
 *               / \
 *              /   \
 *            b/     \c
 *            +-------+
 *           /    d    \
 *          /           \
 * </pre>
 * <b>Fact</b>: d has to be in area B to have a chance to be inside the circle formed by
 *  a,b and c<br>
 *  d is outside B if orient2d(a,b,d) or orient2d(c,a,d) is CW<br>
 *  This preknowledge gives us a way to optimize the incircle test
 * @param pa - triangle point, opposite d
 * @param pb - triangle point
 * @param pc - triangle point
 * @param pd - point opposite a
 * @return {boolean} true if d is inside circle, false if on circle edge
 */
function inCircle(pa, pb, pc, pd) {
    var adx = pa.x - pd.x;
    var ady = pa.y - pd.y;
    var bdx = pb.x - pd.x;
    var bdy = pb.y - pd.y;

    var adxbdy = adx * bdy;
    var bdxady = bdx * ady;
    var oabd = adxbdy - bdxady;
    if (oabd <= 0) {
        return false;
    }

    var cdx = pc.x - pd.x;
    var cdy = pc.y - pd.y;

    var cdxady = cdx * ady;
    var adxcdy = adx * cdy;
    var ocad = cdxady - adxcdy;
    if (ocad <= 0) {
        return false;
    }

    var bdxcdy = bdx * cdy;
    var cdxbdy = cdx * bdy;

    var alift = adx * adx + ady * ady;
    var blift = bdx * bdx + bdy * bdy;
    var clift = cdx * cdx + cdy * cdy;

    var det = alift * (bdxcdy - cdxbdy) + blift * ocad + clift * oabd;
    return det > 0;
}

/**
 * Rotates a triangle pair one vertex CW
 *<pre>
 *       n2                    n2
 *  P +-----+             P +-----+
 *    | t  /|               |\  t |
 *    |   / |               | \   |
 *  n1|  /  |n3           n1|  \  |n3
 *    | /   |    after CW   |   \ |
 *    |/ oT |               | oT \|
 *    +-----+ oP            +-----+
 *       n4                    n4
 * </pre>
 */
function rotateTrianglePair(t, p, ot, op) {
    var n1, n2, n3, n4;
    n1 = t.neighborCCW(p);
    n2 = t.neighborCW(p);
    n3 = ot.neighborCCW(op);
    n4 = ot.neighborCW(op);

    var ce1, ce2, ce3, ce4;
    ce1 = t.getConstrainedEdgeCCW(p);
    ce2 = t.getConstrainedEdgeCW(p);
    ce3 = ot.getConstrainedEdgeCCW(op);
    ce4 = ot.getConstrainedEdgeCW(op);

    var de1, de2, de3, de4;
    de1 = t.getDelaunayEdgeCCW(p);
    de2 = t.getDelaunayEdgeCW(p);
    de3 = ot.getDelaunayEdgeCCW(op);
    de4 = ot.getDelaunayEdgeCW(op);

    t.legalize(p, op);
    ot.legalize(op, p);

    // Remap delaunay_edge
    ot.setDelaunayEdgeCCW(p, de1);
    t.setDelaunayEdgeCW(p, de2);
    t.setDelaunayEdgeCCW(op, de3);
    ot.setDelaunayEdgeCW(op, de4);

    // Remap constrained_edge
    ot.setConstrainedEdgeCCW(p, ce1);
    t.setConstrainedEdgeCW(p, ce2);
    t.setConstrainedEdgeCCW(op, ce3);
    ot.setConstrainedEdgeCW(op, ce4);

    // Remap neighbors
    // XXX: might optimize the markNeighbor by keeping track of
    //      what side should be assigned to what neighbor after the
    //      rotation. Now mark neighbor does lots of testing to find
    //      the right side.
    t.clearNeighbors();
    ot.clearNeighbors();
    if (n1) {
        ot.markNeighbor(n1);
    }
    if (n2) {
        t.markNeighbor(n2);
    }
    if (n3) {
        t.markNeighbor(n3);
    }
    if (n4) {
        ot.markNeighbor(n4);
    }
    t.markNeighbor(ot);
}

/**
 * Fills a basin that has formed on the Advancing Front to the right
 * of given node.<br>
 * First we decide a left,bottom and right node that forms the
 * boundaries of the basin. Then we do a reqursive fill.
 *
 * @param {!SweepContext} tcx - SweepContext object
 * @param node - starting node, this or next node will be left node
 */
function fillBasin(tcx, node) {
    if (orient2d(node.point, node.next.point, node.next.next.point) === Orientation.CCW) {
        tcx.basin.left_node = node.next.next;
    } else {
        tcx.basin.left_node = node.next;
    }

    // Find the bottom and right node
    tcx.basin.bottom_node = tcx.basin.left_node;
    while (tcx.basin.bottom_node.next && tcx.basin.bottom_node.point.y >= tcx.basin.bottom_node.next.point.y) {
        tcx.basin.bottom_node = tcx.basin.bottom_node.next;
    }
    if (tcx.basin.bottom_node === tcx.basin.left_node) {
        // No valid basin
        return;
    }

    tcx.basin.right_node = tcx.basin.bottom_node;
    while (tcx.basin.right_node.next && tcx.basin.right_node.point.y < tcx.basin.right_node.next.point.y) {
        tcx.basin.right_node = tcx.basin.right_node.next;
    }
    if (tcx.basin.right_node === tcx.basin.bottom_node) {
        // No valid basins
        return;
    }

    tcx.basin.width = tcx.basin.right_node.point.x - tcx.basin.left_node.point.x;
    tcx.basin.left_highest = tcx.basin.left_node.point.y > tcx.basin.right_node.point.y;

    fillBasinReq(tcx, tcx.basin.bottom_node);
}

/**
 * Recursive algorithm to fill a Basin with triangles
 *
 * @param {!SweepContext} tcx - SweepContext object
 * @param node - bottom_node
 */
function fillBasinReq(tcx, node) {
    // if shallow stop filling
    if (isShallow(tcx, node)) {
        return;
    }

    fill(tcx, node);

    var o;
    if (node.prev === tcx.basin.left_node && node.next === tcx.basin.right_node) {
        return;
    } else if (node.prev === tcx.basin.left_node) {
        o = orient2d(node.point, node.next.point, node.next.next.point);
        if (o === Orientation.CW) {
            return;
        }
        node = node.next;
    } else if (node.next === tcx.basin.right_node) {
        o = orient2d(node.point, node.prev.point, node.prev.prev.point);
        if (o === Orientation.CCW) {
            return;
        }
        node = node.prev;
    } else {
        // Continue with the neighbor node with lowest Y value
        if (node.prev.point.y < node.next.point.y) {
            node = node.prev;
        } else {
            node = node.next;
        }
    }

    fillBasinReq(tcx, node);
}

function isShallow(tcx, node) {
    var height;
    if (tcx.basin.left_highest) {
        height = tcx.basin.left_node.point.y - node.point.y;
    } else {
        height = tcx.basin.right_node.point.y - node.point.y;
    }

    // if shallow stop filling
    if (tcx.basin.width > height) {
        return true;
    }
    return false;
}

function fillEdgeEvent(tcx, edge, node) {
    if (tcx.edge_event.right) {
        fillRightAboveEdgeEvent(tcx, edge, node);
    } else {
        fillLeftAboveEdgeEvent(tcx, edge, node);
    }
}

function fillRightAboveEdgeEvent(tcx, edge, node) {
    while (node.next.point.x < edge.p.x) {
        // Check if next node is below the edge
        if (orient2d(edge.q, node.next.point, edge.p) === Orientation.CCW) {
            fillRightBelowEdgeEvent(tcx, edge, node);
        } else {
            node = node.next;
        }
    }
}

function fillRightBelowEdgeEvent(tcx, edge, node) {
    if (node.point.x < edge.p.x) {
        if (orient2d(node.point, node.next.point, node.next.next.point) === Orientation.CCW) {
            // Concave
            fillRightConcaveEdgeEvent(tcx, edge, node);
        } else {
            // Convex
            fillRightConvexEdgeEvent(tcx, edge, node);
            // Retry this one
            fillRightBelowEdgeEvent(tcx, edge, node);
        }
    }
}

function fillRightConcaveEdgeEvent(tcx, edge, node) {
    fill(tcx, node.next);
    if (node.next.point !== edge.p) {
        // Next above or below edge?
        if (orient2d(edge.q, node.next.point, edge.p) === Orientation.CCW) {
            // Below
            if (orient2d(node.point, node.next.point, node.next.next.point) === Orientation.CCW) {
                // Next is concave
                fillRightConcaveEdgeEvent(tcx, edge, node);
            } else {
                // Next is convex
                /* jshint noempty:false */
            }
        }
    }
}

function fillRightConvexEdgeEvent(tcx, edge, node) {
    // Next concave or convex?
    if (orient2d(node.next.point, node.next.next.point, node.next.next.next.point) === Orientation.CCW) {
        // Concave
        fillRightConcaveEdgeEvent(tcx, edge, node.next);
    } else {
        // Convex
        // Next above or below edge?
        if (orient2d(edge.q, node.next.next.point, edge.p) === Orientation.CCW) {
            // Below
            fillRightConvexEdgeEvent(tcx, edge, node.next);
        } else {
            // Above
            /* jshint noempty:false */
        }
    }
}

function fillLeftAboveEdgeEvent(tcx, edge, node) {
    while (node.prev.point.x > edge.p.x) {
        // Check if next node is below the edge
        if (orient2d(edge.q, node.prev.point, edge.p) === Orientation.CW) {
            fillLeftBelowEdgeEvent(tcx, edge, node);
        } else {
            node = node.prev;
        }
    }
}

function fillLeftBelowEdgeEvent(tcx, edge, node) {
    if (node.point.x > edge.p.x) {
        if (orient2d(node.point, node.prev.point, node.prev.prev.point) === Orientation.CW) {
            // Concave
            fillLeftConcaveEdgeEvent(tcx, edge, node);
        } else {
            // Convex
            fillLeftConvexEdgeEvent(tcx, edge, node);
            // Retry this one
            fillLeftBelowEdgeEvent(tcx, edge, node);
        }
    }
}

function fillLeftConvexEdgeEvent(tcx, edge, node) {
    // Next concave or convex?
    if (orient2d(node.prev.point, node.prev.prev.point, node.prev.prev.prev.point) === Orientation.CW) {
        // Concave
        fillLeftConcaveEdgeEvent(tcx, edge, node.prev);
    } else {
        // Convex
        // Next above or below edge?
        if (orient2d(edge.q, node.prev.prev.point, edge.p) === Orientation.CW) {
            // Below
            fillLeftConvexEdgeEvent(tcx, edge, node.prev);
        } else {
            // Above
            /* jshint noempty:false */
        }
    }
}

function fillLeftConcaveEdgeEvent(tcx, edge, node) {
    fill(tcx, node.prev);
    if (node.prev.point !== edge.p) {
        // Next above or below edge?
        if (orient2d(edge.q, node.prev.point, edge.p) === Orientation.CW) {
            // Below
            if (orient2d(node.point, node.prev.point, node.prev.prev.point) === Orientation.CW) {
                // Next is concave
                fillLeftConcaveEdgeEvent(tcx, edge, node);
            } else {
                // Next is convex
                /* jshint noempty:false */
            }
        }
    }
}

function flipEdgeEvent(tcx, ep, eq, t, p) {
    var ot = t.neighborAcross(p);
    assert(ot, "FLIP failed due to missing triangle!");

    var op = ot.oppositePoint(t, p);

    // Additional check from Java version (see issue #88)
    if (t.getConstrainedEdgeAcross(p)) {
        var index = t.index(p);
        throw new PointError("poly2tri Intersecting Constraints",
                [p, op, t.getPoint((index + 1) % 3), t.getPoint((index + 2) % 3)]);
    }

    if (inScanArea(p, t.pointCCW(p), t.pointCW(p), op)) {
        // Lets rotate shared edge one vertex CW
        rotateTrianglePair(t, p, ot, op);
        tcx.mapTriangleToNodes(t);
        tcx.mapTriangleToNodes(ot);

        // XXX: in the original C++ code for the next 2 lines, we are
        // comparing point values (and not pointers). In this JavaScript
        // code, we are comparing point references (pointers). This works
        // because we can't have 2 different points with the same values.
        // But to be really equivalent, we should use "Point.equals" here.
        if (p === eq && op === ep) {
            if (eq === tcx.edge_event.constrained_edge.q && ep === tcx.edge_event.constrained_edge.p) {
                t.markConstrainedEdgeByPoints(ep, eq);
                ot.markConstrainedEdgeByPoints(ep, eq);
                legalize(tcx, t);
                legalize(tcx, ot);
            } else {
                // XXX: I think one of the triangles should be legalized here?
                /* jshint noempty:false */
            }
        } else {
            var o = orient2d(eq, op, ep);
            t = nextFlipTriangle(tcx, o, t, ot, p, op);
            flipEdgeEvent(tcx, ep, eq, t, p);
        }
    } else {
        var newP = nextFlipPoint(ep, eq, ot, op);
        flipScanEdgeEvent(tcx, ep, eq, t, ot, newP);
        edgeEventByPoints(tcx, ep, eq, t, p);
    }
}

/**
 * After a flip we have two triangles and know that only one will still be
 * intersecting the edge. So decide which to contiune with and legalize the other
 *
 * @param {!SweepContext} tcx - SweepContext object
 * @param o - should be the result of an orient2d( eq, op, ep )
 * @param t - triangle 1
 * @param ot - triangle 2
 * @param p - a point shared by both triangles
 * @param op - another point shared by both triangles
 * @return returns the triangle still intersecting the edge
 */
function nextFlipTriangle(tcx, o, t, ot, p, op) {
    var edge_index;
    if (o === Orientation.CCW) {
        // ot is not crossing edge after flip
        edge_index = ot.edgeIndex(p, op);
        ot.delaunay_edge[edge_index] = true;
        legalize(tcx, ot);
        ot.clearDelaunayEdges();
        return t;
    }

    // t is not crossing edge after flip
    edge_index = t.edgeIndex(p, op);

    t.delaunay_edge[edge_index] = true;
    legalize(tcx, t);
    t.clearDelaunayEdges();
    return ot;
}

/**
 * When we need to traverse from one triangle to the next we need
 * the point in current triangle that is the opposite point to the next
 * triangle.
 */
function nextFlipPoint(ep, eq, ot, op) {
    var o2d = orient2d(eq, op, ep);
    if (o2d === Orientation.CW) {
        // Right
        return ot.pointCCW(op);
    } else if (o2d === Orientation.CCW) {
        // Left
        return ot.pointCW(op);
    } else {
        throw new PointError("poly2tri [Unsupported] nextFlipPoint: opposing point on constrained edge!", [eq, op, ep]);
    }
}

/**
 * Scan part of the FlipScan algorithm<br>
 * When a triangle pair isn't flippable we will scan for the next
 * point that is inside the flip triangle scan area. When found
 * we generate a new flipEdgeEvent
 *
 * @param {!SweepContext} tcx - SweepContext object
 * @param ep - last point on the edge we are traversing
 * @param eq - first point on the edge we are traversing
 * @param {!Triangle} flip_triangle - the current triangle sharing the point eq with edge
 * @param t
 * @param p
 */
function flipScanEdgeEvent(tcx, ep, eq, flip_triangle, t, p) {
    var ot = t.neighborAcross(p);
    assert(ot, "FLIP failed due to missing triangle");

    var op = ot.oppositePoint(t, p);

    if (inScanArea(eq, flip_triangle.pointCCW(eq), flip_triangle.pointCW(eq), op)) {
        // flip with new edge op.eq
        flipEdgeEvent(tcx, eq, op, ot, op);
    } else {
        var newP = nextFlipPoint(ep, eq, ot, op);
        flipScanEdgeEvent(tcx, ep, eq, flip_triangle, ot, newP);
    }
}


// ----------------------------------------------------------------------Exports

exports.triangulate = triangulate;

},{"./advancingfront":15,"./assert":16,"./pointerror":18,"./triangle":22,"./utils":23}],21:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint maxcomplexity:6 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var PointError = require('./pointerror');
var Point = require('./point');
var Triangle = require('./triangle');
var sweep = require('./sweep');
var AdvancingFront = require('./advancingfront');
var Node = AdvancingFront.Node;


// ------------------------------------------------------------------------utils

/**
 * Initial triangle factor, seed triangle will extend 30% of
 * PointSet width to both left and right.
 * @private
 * @const
 */
var kAlpha = 0.3;


// -------------------------------------------------------------------------Edge
/**
 * Represents a simple polygon's edge
 * @constructor
 * @struct
 * @private
 * @param {Point} p1
 * @param {Point} p2
 * @throw {PointError} if p1 is same as p2
 */
var Edge = function(p1, p2) {
    this.p = p1;
    this.q = p2;

    if (p1.y > p2.y) {
        this.q = p1;
        this.p = p2;
    } else if (p1.y === p2.y) {
        if (p1.x > p2.x) {
            this.q = p1;
            this.p = p2;
        } else if (p1.x === p2.x) {
            throw new PointError('poly2tri Invalid Edge constructor: repeated points!', [p1]);
        }
    }

    if (!this.q._p2t_edge_list) {
        this.q._p2t_edge_list = [];
    }
    this.q._p2t_edge_list.push(this);
};


// ------------------------------------------------------------------------Basin
/**
 * @constructor
 * @struct
 * @private
 */
var Basin = function() {
    /** @type {Node} */
    this.left_node = null;
    /** @type {Node} */
    this.bottom_node = null;
    /** @type {Node} */
    this.right_node = null;
    /** @type {number} */
    this.width = 0.0;
    /** @type {boolean} */
    this.left_highest = false;
};

Basin.prototype.clear = function() {
    this.left_node = null;
    this.bottom_node = null;
    this.right_node = null;
    this.width = 0.0;
    this.left_highest = false;
};

// --------------------------------------------------------------------EdgeEvent
/**
 * @constructor
 * @struct
 * @private
 */
var EdgeEvent = function() {
    /** @type {Edge} */
    this.constrained_edge = null;
    /** @type {boolean} */
    this.right = false;
};

// ----------------------------------------------------SweepContext (public API)
/**
 * SweepContext constructor option
 * @typedef {Object} SweepContextOptions
 * @property {boolean=} cloneArrays - if <code>true</code>, do a shallow copy of the Array parameters
 *                  (contour, holes). Points inside arrays are never copied.
 *                  Default is <code>false</code> : keep a reference to the array arguments,
 *                  who will be modified in place.
 */
/**
 * Constructor for the triangulation context.
 * It accepts a simple polyline (with non repeating points), 
 * which defines the constrained edges.
 *
 * @example
 *          var contour = [
 *              new poly2tri.Point(100, 100),
 *              new poly2tri.Point(100, 300),
 *              new poly2tri.Point(300, 300),
 *              new poly2tri.Point(300, 100)
 *          ];
 *          var swctx = new poly2tri.SweepContext(contour, {cloneArrays: true});
 * @example
 *          var contour = [{x:100, y:100}, {x:100, y:300}, {x:300, y:300}, {x:300, y:100}];
 *          var swctx = new poly2tri.SweepContext(contour, {cloneArrays: true});
 * @constructor
 * @public
 * @struct
 * @param {Array.<XY>} contour - array of point objects. The points can be either {@linkcode Point} instances,
 *          or any "Point like" custom class with <code>{x, y}</code> attributes.
 * @param {SweepContextOptions=} options - constructor options
 */
var SweepContext = function(contour, options) {
    options = options || {};
    this.triangles_ = [];
    this.map_ = [];
    this.points_ = (options.cloneArrays ? contour.slice(0) : contour);
    this.edge_list = [];

    // Bounding box of all points. Computed at the start of the triangulation, 
    // it is stored in case it is needed by the caller.
    this.pmin_ = this.pmax_ = null;

    /**
     * Advancing front
     * @private
     * @type {AdvancingFront}
     */
    this.front_ = null;

    /**
     * head point used with advancing front
     * @private
     * @type {Point}
     */
    this.head_ = null;

    /**
     * tail point used with advancing front
     * @private
     * @type {Point}
     */
    this.tail_ = null;

    /**
     * @private
     * @type {Node}
     */
    this.af_head_ = null;
    /**
     * @private
     * @type {Node}
     */
    this.af_middle_ = null;
    /**
     * @private
     * @type {Node}
     */
    this.af_tail_ = null;

    this.basin = new Basin();
    this.edge_event = new EdgeEvent();

    this.initEdges(this.points_);
};


/**
 * Add a hole to the constraints
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      var hole = [
 *          new poly2tri.Point(200, 200),
 *          new poly2tri.Point(200, 250),
 *          new poly2tri.Point(250, 250)
 *      ];
 *      swctx.addHole(hole);
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      swctx.addHole([{x:200, y:200}, {x:200, y:250}, {x:250, y:250}]);
 * @public
 * @param {Array.<XY>} polyline - array of "Point like" objects with {x,y}
 */
SweepContext.prototype.addHole = function(polyline) {
    this.initEdges(polyline);
    var i, len = polyline.length;
    for (i = 0; i < len; i++) {
        this.points_.push(polyline[i]);
    }
    return this; // for chaining
};

/**
 * For backward compatibility
 * @function
 * @deprecated use {@linkcode SweepContext#addHole} instead
 */
SweepContext.prototype.AddHole = SweepContext.prototype.addHole;


/**
 * Add several holes to the constraints
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      var holes = [
 *          [ new poly2tri.Point(200, 200), new poly2tri.Point(200, 250), new poly2tri.Point(250, 250) ],
 *          [ new poly2tri.Point(300, 300), new poly2tri.Point(300, 350), new poly2tri.Point(350, 350) ]
 *      ];
 *      swctx.addHoles(holes);
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      var holes = [
 *          [{x:200, y:200}, {x:200, y:250}, {x:250, y:250}],
 *          [{x:300, y:300}, {x:300, y:350}, {x:350, y:350}]
 *      ];
 *      swctx.addHoles(holes);
 * @public
 * @param {Array.<Array.<XY>>} holes - array of array of "Point like" objects with {x,y}
 */
// Method added in the JavaScript version (was not present in the c++ version)
SweepContext.prototype.addHoles = function(holes) {
    var i, len = holes.length;
    for (i = 0; i < len; i++) {
        this.initEdges(holes[i]);
    }
    this.points_ = this.points_.concat.apply(this.points_, holes);
    return this; // for chaining
};


/**
 * Add a Steiner point to the constraints
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      var point = new poly2tri.Point(150, 150);
 *      swctx.addPoint(point);
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      swctx.addPoint({x:150, y:150});
 * @public
 * @param {XY} point - any "Point like" object with {x,y}
 */
SweepContext.prototype.addPoint = function(point) {
    this.points_.push(point);
    return this; // for chaining
};

/**
 * For backward compatibility
 * @function
 * @deprecated use {@linkcode SweepContext#addPoint} instead
 */
SweepContext.prototype.AddPoint = SweepContext.prototype.addPoint;


/**
 * Add several Steiner points to the constraints
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      var points = [
 *          new poly2tri.Point(150, 150),
 *          new poly2tri.Point(200, 250),
 *          new poly2tri.Point(250, 250)
 *      ];
 *      swctx.addPoints(points);
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      swctx.addPoints([{x:150, y:150}, {x:200, y:250}, {x:250, y:250}]);
 * @public
 * @param {Array.<XY>} points - array of "Point like" object with {x,y}
 */
// Method added in the JavaScript version (was not present in the c++ version)
SweepContext.prototype.addPoints = function(points) {
    this.points_ = this.points_.concat(points);
    return this; // for chaining
};


/**
 * Triangulate the polygon with holes and Steiner points.
 * Do this AFTER you've added the polyline, holes, and Steiner points
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      swctx.triangulate();
 *      var triangles = swctx.getTriangles();
 * @public
 */
// Shortcut method for sweep.triangulate(SweepContext).
// Method added in the JavaScript version (was not present in the c++ version)
SweepContext.prototype.triangulate = function() {
    sweep.triangulate(this);
    return this; // for chaining
};


/**
 * Get the bounding box of the provided constraints (contour, holes and 
 * Steinter points). Warning : these values are not available if the triangulation 
 * has not been done yet.
 * @public
 * @returns {{min:Point,max:Point}} object with 'min' and 'max' Point
 */
// Method added in the JavaScript version (was not present in the c++ version)
SweepContext.prototype.getBoundingBox = function() {
    return {min: this.pmin_, max: this.pmax_};
};

/**
 * Get result of triangulation.
 * The output triangles have vertices which are references
 * to the initial input points (not copies): any custom fields in the
 * initial points can be retrieved in the output triangles.
 * @example
 *      var swctx = new poly2tri.SweepContext(contour);
 *      swctx.triangulate();
 *      var triangles = swctx.getTriangles();
 * @example
 *      var contour = [{x:100, y:100, id:1}, {x:100, y:300, id:2}, {x:300, y:300, id:3}];
 *      var swctx = new poly2tri.SweepContext(contour);
 *      swctx.triangulate();
 *      var triangles = swctx.getTriangles();
 *      typeof triangles[0].getPoint(0).id
 *      // → "number"
 * @public
 * @returns {array<Triangle>}   array of triangles
 */
SweepContext.prototype.getTriangles = function() {
    return this.triangles_;
};

/**
 * For backward compatibility
 * @function
 * @deprecated use {@linkcode SweepContext#getTriangles} instead
 */
SweepContext.prototype.GetTriangles = SweepContext.prototype.getTriangles;


// ---------------------------------------------------SweepContext (private API)

/** @private */
SweepContext.prototype.front = function() {
    return this.front_;
};

/** @private */
SweepContext.prototype.pointCount = function() {
    return this.points_.length;
};

/** @private */
SweepContext.prototype.head = function() {
    return this.head_;
};

/** @private */
SweepContext.prototype.setHead = function(p1) {
    this.head_ = p1;
};

/** @private */
SweepContext.prototype.tail = function() {
    return this.tail_;
};

/** @private */
SweepContext.prototype.setTail = function(p1) {
    this.tail_ = p1;
};

/** @private */
SweepContext.prototype.getMap = function() {
    return this.map_;
};

/** @private */
SweepContext.prototype.initTriangulation = function() {
    var xmax = this.points_[0].x;
    var xmin = this.points_[0].x;
    var ymax = this.points_[0].y;
    var ymin = this.points_[0].y;

    // Calculate bounds
    var i, len = this.points_.length;
    for (i = 1; i < len; i++) {
        var p = this.points_[i];
        /* jshint expr:true */
        (p.x > xmax) && (xmax = p.x);
        (p.x < xmin) && (xmin = p.x);
        (p.y > ymax) && (ymax = p.y);
        (p.y < ymin) && (ymin = p.y);
    }
    this.pmin_ = new Point(xmin, ymin);
    this.pmax_ = new Point(xmax, ymax);

    var dx = kAlpha * (xmax - xmin);
    var dy = kAlpha * (ymax - ymin);
    this.head_ = new Point(xmax + dx, ymin - dy);
    this.tail_ = new Point(xmin - dx, ymin - dy);

    // Sort points along y-axis
    this.points_.sort(Point.compare);
};

/** @private */
SweepContext.prototype.initEdges = function(polyline) {
    var i, len = polyline.length;
    for (i = 0; i < len; ++i) {
        this.edge_list.push(new Edge(polyline[i], polyline[(i + 1) % len]));
    }
};

/** @private */
SweepContext.prototype.getPoint = function(index) {
    return this.points_[index];
};

/** @private */
SweepContext.prototype.addToMap = function(triangle) {
    this.map_.push(triangle);
};

/** @private */
SweepContext.prototype.locateNode = function(point) {
    return this.front_.locateNode(point.x);
};

/** @private */
SweepContext.prototype.createAdvancingFront = function() {
    var head;
    var middle;
    var tail;
    // Initial triangle
    var triangle = new Triangle(this.points_[0], this.tail_, this.head_);

    this.map_.push(triangle);

    head = new Node(triangle.getPoint(1), triangle);
    middle = new Node(triangle.getPoint(0), triangle);
    tail = new Node(triangle.getPoint(2));

    this.front_ = new AdvancingFront(head, tail);

    head.next = middle;
    middle.next = tail;
    middle.prev = head;
    tail.prev = middle;
};

/** @private */
SweepContext.prototype.removeNode = function(node) {
    // do nothing
    /* jshint unused:false */
};

/** @private */
SweepContext.prototype.mapTriangleToNodes = function(t) {
    for (var i = 0; i < 3; ++i) {
        if (!t.getNeighbor(i)) {
            var n = this.front_.locatePoint(t.pointCW(t.getPoint(i)));
            if (n) {
                n.triangle = t;
            }
        }
    }
};

/** @private */
SweepContext.prototype.removeFromMap = function(triangle) {
    var i, map = this.map_, len = map.length;
    for (i = 0; i < len; i++) {
        if (map[i] === triangle) {
            map.splice(i, 1);
            break;
        }
    }
};

/**
 * Do a depth first traversal to collect triangles
 * @private
 * @param {Triangle} triangle start
 */
SweepContext.prototype.meshClean = function(triangle) {
    // New implementation avoids recursive calls and use a loop instead.
    // Cf. issues # 57, 65 and 69.
    var triangles = [triangle], t, i;
    /* jshint boss:true */
    while (t = triangles.pop()) {
        if (!t.isInterior()) {
            t.setInterior(true);
            this.triangles_.push(t);
            for (i = 0; i < 3; i++) {
                if (!t.constrained_edge[i]) {
                    triangles.push(t.getNeighbor(i));
                }
            }
        }
    }
};

// ----------------------------------------------------------------------Exports

module.exports = SweepContext;

},{"./advancingfront":15,"./point":17,"./pointerror":18,"./sweep":20,"./triangle":22}],22:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 *
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint maxcomplexity:10 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var xy = require("./xy");


// ---------------------------------------------------------------------Triangle
/**
 * Triangle class.<br>
 * Triangle-based data structures are known to have better performance than
 * quad-edge structures.
 * See: J. Shewchuk, "Triangle: Engineering a 2D Quality Mesh Generator and
 * Delaunay Triangulator", "Triangulations in CGAL"
 *
 * @constructor
 * @struct
 * @param {!XY} pa  point object with {x,y}
 * @param {!XY} pb  point object with {x,y}
 * @param {!XY} pc  point object with {x,y}
 */
var Triangle = function(a, b, c) {
    /**
     * Triangle points
     * @private
     * @type {Array.<XY>}
     */
    this.points_ = [a, b, c];

    /**
     * Neighbor list
     * @private
     * @type {Array.<Triangle>}
     */
    this.neighbors_ = [null, null, null];

    /**
     * Has this triangle been marked as an interior triangle?
     * @private
     * @type {boolean}
     */
    this.interior_ = false;

    /**
     * Flags to determine if an edge is a Constrained edge
     * @private
     * @type {Array.<boolean>}
     */
    this.constrained_edge = [false, false, false];

    /**
     * Flags to determine if an edge is a Delauney edge
     * @private
     * @type {Array.<boolean>}
     */
    this.delaunay_edge = [false, false, false];
};

var p2s = xy.toString;
/**
 * For pretty printing ex. <code>"[(5;42)(10;20)(21;30)]"</code>.
 * @public
 * @return {string}
 */
Triangle.prototype.toString = function() {
    return ("[" + p2s(this.points_[0]) + p2s(this.points_[1]) + p2s(this.points_[2]) + "]");
};

/**
 * Get one vertice of the triangle.
 * The output triangles of a triangulation have vertices which are references
 * to the initial input points (not copies): any custom fields in the
 * initial points can be retrieved in the output triangles.
 * @example
 *      var contour = [{x:100, y:100, id:1}, {x:100, y:300, id:2}, {x:300, y:300, id:3}];
 *      var swctx = new poly2tri.SweepContext(contour);
 *      swctx.triangulate();
 *      var triangles = swctx.getTriangles();
 *      typeof triangles[0].getPoint(0).id
 *      // → "number"
 * @param {number} index - vertice index: 0, 1 or 2
 * @public
 * @returns {XY}
 */
Triangle.prototype.getPoint = function(index) {
    return this.points_[index];
};

/**
 * For backward compatibility
 * @function
 * @deprecated use {@linkcode Triangle#getPoint} instead
 */
Triangle.prototype.GetPoint = Triangle.prototype.getPoint;

/**
 * Get all 3 vertices of the triangle as an array
 * @public
 * @return {Array.<XY>}
 */
// Method added in the JavaScript version (was not present in the c++ version)
Triangle.prototype.getPoints = function() {
    return this.points_;
};

/**
 * @private
 * @param {number} index
 * @returns {?Triangle}
 */
Triangle.prototype.getNeighbor = function(index) {
    return this.neighbors_[index];
};

/**
 * Test if this Triangle contains the Point object given as parameter as one of its vertices.
 * Only point references are compared, not values.
 * @public
 * @param {XY} point - point object with {x,y}
 * @return {boolean} <code>True</code> if the Point object is of the Triangle's vertices,
 *         <code>false</code> otherwise.
 */
Triangle.prototype.containsPoint = function(point) {
    var points = this.points_;
    // Here we are comparing point references, not values
    return (point === points[0] || point === points[1] || point === points[2]);
};

/**
 * Test if this Triangle contains the Edge object given as parameter as its
 * bounding edges. Only point references are compared, not values.
 * @private
 * @param {Edge} edge
 * @return {boolean} <code>True</code> if the Edge object is of the Triangle's bounding
 *         edges, <code>false</code> otherwise.
 */
Triangle.prototype.containsEdge = function(edge) {
    return this.containsPoint(edge.p) && this.containsPoint(edge.q);
};

/**
 * Test if this Triangle contains the two Point objects given as parameters among its vertices.
 * Only point references are compared, not values.
 * @param {XY} p1 - point object with {x,y}
 * @param {XY} p2 - point object with {x,y}
 * @return {boolean}
 */
Triangle.prototype.containsPoints = function(p1, p2) {
    return this.containsPoint(p1) && this.containsPoint(p2);
};

/**
 * Has this triangle been marked as an interior triangle?
 * @returns {boolean}
 */
Triangle.prototype.isInterior = function() {
    return this.interior_;
};

/**
 * Mark this triangle as an interior triangle
 * @private
 * @param {boolean} interior
 * @returns {Triangle} this
 */
Triangle.prototype.setInterior = function(interior) {
    this.interior_ = interior;
    return this;
};

/**
 * Update neighbor pointers.
 * @private
 * @param {XY} p1 - point object with {x,y}
 * @param {XY} p2 - point object with {x,y}
 * @param {Triangle} t Triangle object.
 * @throws {Error} if can't find objects
 */
Triangle.prototype.markNeighborPointers = function(p1, p2, t) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if ((p1 === points[2] && p2 === points[1]) || (p1 === points[1] && p2 === points[2])) {
        this.neighbors_[0] = t;
    } else if ((p1 === points[0] && p2 === points[2]) || (p1 === points[2] && p2 === points[0])) {
        this.neighbors_[1] = t;
    } else if ((p1 === points[0] && p2 === points[1]) || (p1 === points[1] && p2 === points[0])) {
        this.neighbors_[2] = t;
    } else {
        throw new Error('poly2tri Invalid Triangle.markNeighborPointers() call');
    }
};

/**
 * Exhaustive search to update neighbor pointers
 * @private
 * @param {!Triangle} t
 */
Triangle.prototype.markNeighbor = function(t) {
    var points = this.points_;
    if (t.containsPoints(points[1], points[2])) {
        this.neighbors_[0] = t;
        t.markNeighborPointers(points[1], points[2], this);
    } else if (t.containsPoints(points[0], points[2])) {
        this.neighbors_[1] = t;
        t.markNeighborPointers(points[0], points[2], this);
    } else if (t.containsPoints(points[0], points[1])) {
        this.neighbors_[2] = t;
        t.markNeighborPointers(points[0], points[1], this);
    }
};


Triangle.prototype.clearNeighbors = function() {
    this.neighbors_[0] = null;
    this.neighbors_[1] = null;
    this.neighbors_[2] = null;
};

Triangle.prototype.clearDelaunayEdges = function() {
    this.delaunay_edge[0] = false;
    this.delaunay_edge[1] = false;
    this.delaunay_edge[2] = false;
};

/**
 * Returns the point clockwise to the given point.
 * @private
 * @param {XY} p - point object with {x,y}
 */
Triangle.prototype.pointCW = function(p) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p === points[0]) {
        return points[2];
    } else if (p === points[1]) {
        return points[0];
    } else if (p === points[2]) {
        return points[1];
    } else {
        return null;
    }
};

/**
 * Returns the point counter-clockwise to the given point.
 * @private
 * @param {XY} p - point object with {x,y}
 */
Triangle.prototype.pointCCW = function(p) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p === points[0]) {
        return points[1];
    } else if (p === points[1]) {
        return points[2];
    } else if (p === points[2]) {
        return points[0];
    } else {
        return null;
    }
};

/**
 * Returns the neighbor clockwise to given point.
 * @private
 * @param {XY} p - point object with {x,y}
 */
Triangle.prototype.neighborCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.neighbors_[1];
    } else if (p === this.points_[1]) {
        return this.neighbors_[2];
    } else {
        return this.neighbors_[0];
    }
};

/**
 * Returns the neighbor counter-clockwise to given point.
 * @private
 * @param {XY} p - point object with {x,y}
 */
Triangle.prototype.neighborCCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.neighbors_[2];
    } else if (p === this.points_[1]) {
        return this.neighbors_[0];
    } else {
        return this.neighbors_[1];
    }
};

Triangle.prototype.getConstrainedEdgeCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.constrained_edge[1];
    } else if (p === this.points_[1]) {
        return this.constrained_edge[2];
    } else {
        return this.constrained_edge[0];
    }
};

Triangle.prototype.getConstrainedEdgeCCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.constrained_edge[2];
    } else if (p === this.points_[1]) {
        return this.constrained_edge[0];
    } else {
        return this.constrained_edge[1];
    }
};

// Additional check from Java version (see issue #88)
Triangle.prototype.getConstrainedEdgeAcross = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.constrained_edge[0];
    } else if (p === this.points_[1]) {
        return this.constrained_edge[1];
    } else {
        return this.constrained_edge[2];
    }
};

Triangle.prototype.setConstrainedEdgeCW = function(p, ce) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.constrained_edge[1] = ce;
    } else if (p === this.points_[1]) {
        this.constrained_edge[2] = ce;
    } else {
        this.constrained_edge[0] = ce;
    }
};

Triangle.prototype.setConstrainedEdgeCCW = function(p, ce) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.constrained_edge[2] = ce;
    } else if (p === this.points_[1]) {
        this.constrained_edge[0] = ce;
    } else {
        this.constrained_edge[1] = ce;
    }
};

Triangle.prototype.getDelaunayEdgeCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.delaunay_edge[1];
    } else if (p === this.points_[1]) {
        return this.delaunay_edge[2];
    } else {
        return this.delaunay_edge[0];
    }
};

Triangle.prototype.getDelaunayEdgeCCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.delaunay_edge[2];
    } else if (p === this.points_[1]) {
        return this.delaunay_edge[0];
    } else {
        return this.delaunay_edge[1];
    }
};

Triangle.prototype.setDelaunayEdgeCW = function(p, e) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.delaunay_edge[1] = e;
    } else if (p === this.points_[1]) {
        this.delaunay_edge[2] = e;
    } else {
        this.delaunay_edge[0] = e;
    }
};

Triangle.prototype.setDelaunayEdgeCCW = function(p, e) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.delaunay_edge[2] = e;
    } else if (p === this.points_[1]) {
        this.delaunay_edge[0] = e;
    } else {
        this.delaunay_edge[1] = e;
    }
};

/**
 * The neighbor across to given point.
 * @private
 * @param {XY} p - point object with {x,y}
 * @returns {Triangle}
 */
Triangle.prototype.neighborAcross = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.neighbors_[0];
    } else if (p === this.points_[1]) {
        return this.neighbors_[1];
    } else {
        return this.neighbors_[2];
    }
};

/**
 * @private
 * @param {!Triangle} t Triangle object.
 * @param {XY} p - point object with {x,y}
 */
Triangle.prototype.oppositePoint = function(t, p) {
    var cw = t.pointCW(p);
    return this.pointCW(cw);
};

/**
 * Legalize triangle by rotating clockwise around oPoint
 * @private
 * @param {XY} opoint - point object with {x,y}
 * @param {XY} npoint - point object with {x,y}
 * @throws {Error} if oPoint can not be found
 */
Triangle.prototype.legalize = function(opoint, npoint) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (opoint === points[0]) {
        points[1] = points[0];
        points[0] = points[2];
        points[2] = npoint;
    } else if (opoint === points[1]) {
        points[2] = points[1];
        points[1] = points[0];
        points[0] = npoint;
    } else if (opoint === points[2]) {
        points[0] = points[2];
        points[2] = points[1];
        points[1] = npoint;
    } else {
        throw new Error('poly2tri Invalid Triangle.legalize() call');
    }
};

/**
 * Returns the index of a point in the triangle. 
 * The point *must* be a reference to one of the triangle's vertices.
 * @private
 * @param {XY} p - point object with {x,y}
 * @returns {number} index 0, 1 or 2
 * @throws {Error} if p can not be found
 */
Triangle.prototype.index = function(p) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p === points[0]) {
        return 0;
    } else if (p === points[1]) {
        return 1;
    } else if (p === points[2]) {
        return 2;
    } else {
        throw new Error('poly2tri Invalid Triangle.index() call');
    }
};

/**
 * @private
 * @param {XY} p1 - point object with {x,y}
 * @param {XY} p2 - point object with {x,y}
 * @return {number} index 0, 1 or 2, or -1 if errror
 */
Triangle.prototype.edgeIndex = function(p1, p2) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p1 === points[0]) {
        if (p2 === points[1]) {
            return 2;
        } else if (p2 === points[2]) {
            return 1;
        }
    } else if (p1 === points[1]) {
        if (p2 === points[2]) {
            return 0;
        } else if (p2 === points[0]) {
            return 2;
        }
    } else if (p1 === points[2]) {
        if (p2 === points[0]) {
            return 1;
        } else if (p2 === points[1]) {
            return 0;
        }
    }
    return -1;
};

/**
 * Mark an edge of this triangle as constrained.
 * @private
 * @param {number} index - edge index
 */
Triangle.prototype.markConstrainedEdgeByIndex = function(index) {
    this.constrained_edge[index] = true;
};
/**
 * Mark an edge of this triangle as constrained.
 * @private
 * @param {Edge} edge instance
 */
Triangle.prototype.markConstrainedEdgeByEdge = function(edge) {
    this.markConstrainedEdgeByPoints(edge.p, edge.q);
};
/**
 * Mark an edge of this triangle as constrained.
 * This method takes two Point instances defining the edge of the triangle.
 * @private
 * @param {XY} p - point object with {x,y}
 * @param {XY} q - point object with {x,y}
 */
Triangle.prototype.markConstrainedEdgeByPoints = function(p, q) {
    var points = this.points_;
    // Here we are comparing point references, not values        
    if ((q === points[0] && p === points[1]) || (q === points[1] && p === points[0])) {
        this.constrained_edge[2] = true;
    } else if ((q === points[0] && p === points[2]) || (q === points[2] && p === points[0])) {
        this.constrained_edge[1] = true;
    } else if ((q === points[1] && p === points[2]) || (q === points[2] && p === points[1])) {
        this.constrained_edge[0] = true;
    }
};


// ---------------------------------------------------------Exports (public API)

module.exports = Triangle;

},{"./xy":24}],23:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";

/**
 * Precision to detect repeated or collinear points
 * @private
 * @const {number}
 * @default
 */
var EPSILON = 1e-12;
exports.EPSILON = EPSILON;

/**
 * @private
 * @enum {number}
 * @readonly
 */
var Orientation = {
    "CW": 1,
    "CCW": -1,
    "COLLINEAR": 0
};
exports.Orientation = Orientation;


/**
 * Formula to calculate signed area<br>
 * Positive if CCW<br>
 * Negative if CW<br>
 * 0 if collinear<br>
 * <pre>
 * A[P1,P2,P3]  =  (x1*y2 - y1*x2) + (x2*y3 - y2*x3) + (x3*y1 - y3*x1)
 *              =  (x1-x3)*(y2-y3) - (y1-y3)*(x2-x3)
 * </pre>
 *
 * @private
 * @param {!XY} pa  point object with {x,y}
 * @param {!XY} pb  point object with {x,y}
 * @param {!XY} pc  point object with {x,y}
 * @return {Orientation}
 */
function orient2d(pa, pb, pc) {
    var detleft = (pa.x - pc.x) * (pb.y - pc.y);
    var detright = (pa.y - pc.y) * (pb.x - pc.x);
    var val = detleft - detright;
    if (val > -(EPSILON) && val < (EPSILON)) {
        return Orientation.COLLINEAR;
    } else if (val > 0) {
        return Orientation.CCW;
    } else {
        return Orientation.CW;
    }
}
exports.orient2d = orient2d;


/**
 *
 * @private
 * @param {!XY} pa  point object with {x,y}
 * @param {!XY} pb  point object with {x,y}
 * @param {!XY} pc  point object with {x,y}
 * @param {!XY} pd  point object with {x,y}
 * @return {boolean}
 */
function inScanArea(pa, pb, pc, pd) {
    var oadb = (pa.x - pb.x) * (pd.y - pb.y) - (pd.x - pb.x) * (pa.y - pb.y);
    if (oadb >= -EPSILON) {
        return false;
    }

    var oadc = (pa.x - pc.x) * (pd.y - pc.y) - (pd.x - pc.x) * (pa.y - pc.y);
    if (oadc <= EPSILON) {
        return false;
    }
    return true;
}
exports.inScanArea = inScanArea;


/**
 * Check if the angle between (pa,pb) and (pa,pc) is obtuse i.e. (angle > π/2 || angle < -π/2)
 *
 * @private
 * @param {!XY} pa  point object with {x,y}
 * @param {!XY} pb  point object with {x,y}
 * @param {!XY} pc  point object with {x,y}
 * @return {boolean} true if angle is obtuse
 */
function isAngleObtuse(pa, pb, pc) {
    var ax = pb.x - pa.x;
    var ay = pb.y - pa.y;
    var bx = pc.x - pa.x;
    var by = pc.y - pa.y;
    return (ax * bx + ay * by) < 0;
}
exports.isAngleObtuse = isAngleObtuse;


},{}],24:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2014, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2014, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";

/**
 * The following functions operate on "Point" or any "Point like" object with {x,y},
 * as defined by the {@link XY} type
 * ([duck typing]{@link http://en.wikipedia.org/wiki/Duck_typing}).
 * @module
 * @private
 */

/**
 * poly2tri.js supports using custom point class instead of {@linkcode Point}.
 * Any "Point like" object with <code>{x, y}</code> attributes is supported
 * to initialize the SweepContext polylines and points
 * ([duck typing]{@link http://en.wikipedia.org/wiki/Duck_typing}).
 *
 * poly2tri.js might add extra fields to the point objects when computing the
 * triangulation : they are prefixed with <code>_p2t_</code> to avoid collisions
 * with fields in the custom class.
 *
 * @example
 *      var contour = [{x:100, y:100}, {x:100, y:300}, {x:300, y:300}, {x:300, y:100}];
 *      var swctx = new poly2tri.SweepContext(contour);
 *
 * @typedef {Object} XY
 * @property {number} x - x coordinate
 * @property {number} y - y coordinate
 */


/**
 * Point pretty printing : prints x and y coordinates.
 * @example
 *      xy.toStringBase({x:5, y:42})
 *      // → "(5;42)"
 * @protected
 * @param {!XY} p - point object with {x,y}
 * @returns {string} <code>"(x;y)"</code>
 */
function toStringBase(p) {
    return ("(" + p.x + ";" + p.y + ")");
}

/**
 * Point pretty printing. Delegates to the point's custom "toString()" method if exists,
 * else simply prints x and y coordinates.
 * @example
 *      xy.toString({x:5, y:42})
 *      // → "(5;42)"
 * @example
 *      xy.toString({x:5,y:42,toString:function() {return this.x+":"+this.y;}})
 *      // → "5:42"
 * @param {!XY} p - point object with {x,y}
 * @returns {string} <code>"(x;y)"</code>
 */
function toString(p) {
    // Try a custom toString first, and fallback to own implementation if none
    var s = p.toString();
    return (s === '[object Object]' ? toStringBase(p) : s);
}


/**
 * Compare two points component-wise. Ordered by y axis first, then x axis.
 * @param {!XY} a - point object with {x,y}
 * @param {!XY} b - point object with {x,y}
 * @return {number} <code>&lt; 0</code> if <code>a &lt; b</code>,
 *         <code>&gt; 0</code> if <code>a &gt; b</code>, 
 *         <code>0</code> otherwise.
 */
function compare(a, b) {
    if (a.y === b.y) {
        return a.x - b.x;
    } else {
        return a.y - b.y;
    }
}

/**
 * Test two Point objects for equality.
 * @param {!XY} a - point object with {x,y}
 * @param {!XY} b - point object with {x,y}
 * @return {boolean} <code>True</code> if <code>a == b</code>, <code>false</code> otherwise.
 */
function equals(a, b) {
    return a.x === b.x && a.y === b.y;
}


module.exports = {
    toString: toString,
    toStringBase: toStringBase,
    compare: compare,
    equals: equals
};

},{}],25:[function(require,module,exports){
var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;

function Matrix3(m) {
    this.val = new ARRAY_TYPE(9);

    if (m) { //assume Matrix3 with val
        this.copy(m);
    } else { //default to identity
        this.idt();
    }
}

var mat3 = Matrix3.prototype;

mat3.clone = function() {
    return new Matrix3(this);
};

mat3.set = function(otherMat) {
    return this.copy(otherMat);
};

mat3.copy = function(otherMat) {
    var out = this.val,
        a = otherMat.val; 
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return this;
};

mat3.fromMat4 = function(m) {
    var a = m.val,
        out = this.val;
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[4];
    out[4] = a[5];
    out[5] = a[6];
    out[6] = a[8];
    out[7] = a[9];
    out[8] = a[10];
    return this;
};

mat3.fromArray = function(a) {
    var out = this.val;
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return this;
};

mat3.identity = function() {
    var out = this.val;
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 1;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return this;
};

mat3.transpose = function() {
    var a = this.val,
        a01 = a[1], 
        a02 = a[2], 
        a12 = a[5];
    a[1] = a[3];
    a[2] = a[6];
    a[3] = a01;
    a[5] = a[7];
    a[6] = a02;
    a[7] = a12;
    return this;
};

mat3.invert = function() {
    var a = this.val,
        a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        b01 = a22 * a11 - a12 * a21,
        b11 = -a22 * a10 + a12 * a20,
        b21 = a21 * a10 - a11 * a20,

        // Calculate the determinant
        det = a00 * b01 + a01 * b11 + a02 * b21;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    a[0] = b01 * det;
    a[1] = (-a22 * a01 + a02 * a21) * det;
    a[2] = (a12 * a01 - a02 * a11) * det;
    a[3] = b11 * det;
    a[4] = (a22 * a00 - a02 * a20) * det;
    a[5] = (-a12 * a00 + a02 * a10) * det;
    a[6] = b21 * det;
    a[7] = (-a21 * a00 + a01 * a20) * det;
    a[8] = (a11 * a00 - a01 * a10) * det;
    return this;
};

mat3.adjoint = function() {
    var a = this.val,
        a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8];

    a[0] = (a11 * a22 - a12 * a21);
    a[1] = (a02 * a21 - a01 * a22);
    a[2] = (a01 * a12 - a02 * a11);
    a[3] = (a12 * a20 - a10 * a22);
    a[4] = (a00 * a22 - a02 * a20);
    a[5] = (a02 * a10 - a00 * a12);
    a[6] = (a10 * a21 - a11 * a20);
    a[7] = (a01 * a20 - a00 * a21);
    a[8] = (a00 * a11 - a01 * a10);
    return this;
};

mat3.determinant = function() {
    var a = this.val,
        a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8];

    return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
};

mat3.multiply = function(otherMat) {
    var a = this.val,
        b = otherMat.val,
        a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        b00 = b[0], b01 = b[1], b02 = b[2],
        b10 = b[3], b11 = b[4], b12 = b[5],
        b20 = b[6], b21 = b[7], b22 = b[8];

    a[0] = b00 * a00 + b01 * a10 + b02 * a20;
    a[1] = b00 * a01 + b01 * a11 + b02 * a21;
    a[2] = b00 * a02 + b01 * a12 + b02 * a22;

    a[3] = b10 * a00 + b11 * a10 + b12 * a20;
    a[4] = b10 * a01 + b11 * a11 + b12 * a21;
    a[5] = b10 * a02 + b11 * a12 + b12 * a22;

    a[6] = b20 * a00 + b21 * a10 + b22 * a20;
    a[7] = b20 * a01 + b21 * a11 + b22 * a21;
    a[8] = b20 * a02 + b21 * a12 + b22 * a22;
    return this;
};

mat3.translate = function(v) {
    var a = this.val,
        x = v.x, y = v.y;
    a[6] = x * a[0] + y * a[3] + a[6];
    a[7] = x * a[1] + y * a[4] + a[7];
    a[8] = x * a[2] + y * a[5] + a[8];
    return this;
};

mat3.rotate = function(rad) {
    var a = this.val,
        a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],

        s = Math.sin(rad),
        c = Math.cos(rad);

    a[0] = c * a00 + s * a10;
    a[1] = c * a01 + s * a11;
    a[2] = c * a02 + s * a12;

    a[3] = c * a10 - s * a00;
    a[4] = c * a11 - s * a01;
    a[5] = c * a12 - s * a02;
    return this;
};

mat3.scale = function(v) {
    var a = this.val,
        x = v.x, 
        y = v.y;

    a[0] = x * a[0];
    a[1] = x * a[1];
    a[2] = x * a[2];

    a[3] = y * a[3];
    a[4] = y * a[4];
    a[5] = y * a[5];
    return this;
};

mat3.fromQuat = function(q) {
    var x = q.x, y = q.y, z = q.z, w = q.w,
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2,

        out = this.val;

    out[0] = 1 - (yy + zz);
    out[3] = xy + wz;
    out[6] = xz - wy;

    out[1] = xy - wz;
    out[4] = 1 - (xx + zz);
    out[7] = yz + wx;

    out[2] = xz + wy;
    out[5] = yz - wx;
    out[8] = 1 - (xx + yy);
    return this;
};

mat3.normalFromMat4 = function(m) {
    var a = m.val,
        out = this.val,

        a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        // Calculate the determinant
        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det;

    out[3] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[4] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[5] = (a01 * b08 - a00 * b10 - a03 * b06) * det;

    out[6] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[8] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    return this;
};

mat3.mul = mat3.multiply;

mat3.idt = mat3.identity;

//This is handy for Pool utilities, to "reset" a
//shared object to its default state
mat3.reset = mat3.idt;

mat3.toString = function() {
    var a = this.val;
    return 'Matrix3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + 
                    a[3] + ', ' + a[4] + ', ' + a[5] + ', ' + 
                    a[6] + ', ' + a[7] + ', ' + a[8] + ')';
};

mat3.str = mat3.toString;

module.exports = Matrix3;
},{}],26:[function(require,module,exports){
var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
var EPSILON = 0.000001;

function Matrix4(m) {
    this.val = new ARRAY_TYPE(16);

    if (m) { //assume Matrix4 with val
        this.copy(m);
    } else { //default to identity
        this.idt();
    }
}

var mat4 = Matrix4.prototype;

mat4.clone = function() {
    return new Matrix4(this);
};

mat4.set = function(otherMat) {
    return this.copy(otherMat);
};

mat4.copy = function(otherMat) {
    var out = this.val,
        a = otherMat.val; 
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return this;
};

mat4.fromArray = function(a) {
    var out = this.val;
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return this;
};

mat4.identity = function() {
    var out = this.val;
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return this;
};

mat4.transpose = function() {
    var a = this.val,
        a01 = a[1], a02 = a[2], a03 = a[3],
        a12 = a[6], a13 = a[7],
        a23 = a[11];

    a[1] = a[4];
    a[2] = a[8];
    a[3] = a[12];
    a[4] = a01;
    a[6] = a[9];
    a[7] = a[13];
    a[8] = a02;
    a[9] = a12;
    a[11] = a[14];
    a[12] = a03;
    a[13] = a13;
    a[14] = a23;
    return this;
};

mat4.invert = function() {
    var a = this.val,
        a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        // Calculate the determinant
        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    a[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    a[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    a[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    a[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    a[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    a[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    a[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    a[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    a[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    a[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    a[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    a[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    a[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    a[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    a[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    a[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return this;
};

mat4.adjoint = function() {
    var a = this.val,
        a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    a[0]  =  (a11 * (a22 * a33 - a23 * a32) - a21 * (a12 * a33 - a13 * a32) + a31 * (a12 * a23 - a13 * a22));
    a[1]  = -(a01 * (a22 * a33 - a23 * a32) - a21 * (a02 * a33 - a03 * a32) + a31 * (a02 * a23 - a03 * a22));
    a[2]  =  (a01 * (a12 * a33 - a13 * a32) - a11 * (a02 * a33 - a03 * a32) + a31 * (a02 * a13 - a03 * a12));
    a[3]  = -(a01 * (a12 * a23 - a13 * a22) - a11 * (a02 * a23 - a03 * a22) + a21 * (a02 * a13 - a03 * a12));
    a[4]  = -(a10 * (a22 * a33 - a23 * a32) - a20 * (a12 * a33 - a13 * a32) + a30 * (a12 * a23 - a13 * a22));
    a[5]  =  (a00 * (a22 * a33 - a23 * a32) - a20 * (a02 * a33 - a03 * a32) + a30 * (a02 * a23 - a03 * a22));
    a[6]  = -(a00 * (a12 * a33 - a13 * a32) - a10 * (a02 * a33 - a03 * a32) + a30 * (a02 * a13 - a03 * a12));
    a[7]  =  (a00 * (a12 * a23 - a13 * a22) - a10 * (a02 * a23 - a03 * a22) + a20 * (a02 * a13 - a03 * a12));
    a[8]  =  (a10 * (a21 * a33 - a23 * a31) - a20 * (a11 * a33 - a13 * a31) + a30 * (a11 * a23 - a13 * a21));
    a[9]  = -(a00 * (a21 * a33 - a23 * a31) - a20 * (a01 * a33 - a03 * a31) + a30 * (a01 * a23 - a03 * a21));
    a[10] =  (a00 * (a11 * a33 - a13 * a31) - a10 * (a01 * a33 - a03 * a31) + a30 * (a01 * a13 - a03 * a11));
    a[11] = -(a00 * (a11 * a23 - a13 * a21) - a10 * (a01 * a23 - a03 * a21) + a20 * (a01 * a13 - a03 * a11));
    a[12] = -(a10 * (a21 * a32 - a22 * a31) - a20 * (a11 * a32 - a12 * a31) + a30 * (a11 * a22 - a12 * a21));
    a[13] =  (a00 * (a21 * a32 - a22 * a31) - a20 * (a01 * a32 - a02 * a31) + a30 * (a01 * a22 - a02 * a21));
    a[14] = -(a00 * (a11 * a32 - a12 * a31) - a10 * (a01 * a32 - a02 * a31) + a30 * (a01 * a12 - a02 * a11));
    a[15] =  (a00 * (a11 * a22 - a12 * a21) - a10 * (a01 * a22 - a02 * a21) + a20 * (a01 * a12 - a02 * a11));
    return this;
};

mat4.determinant = function () {
    var a = this.val,
        a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32;

    // Calculate the determinant
    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
};

mat4.multiply = function(otherMat) {
    var a = this.val,
        b = otherMat.val,
        a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    // Cache only the current line of the second matrix
    var b0  = b[0], b1 = b[1], b2 = b[2], b3 = b[3];  
    a[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    a[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    a[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    a[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    a[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    a[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    a[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    a[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    a[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    a[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    a[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    a[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    a[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    a[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    a[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    a[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    return this;
};

mat4.translate = function(v) {
    var x = v.x, y = v.y, z = v.z,
        a = this.val;
    a[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    a[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    a[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    a[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    return this;
};

mat4.scale = function(v) {
    var x = v.x, y = v.y, z = v.z, a = this.val;

    a[0] = a[0] * x;
    a[1] = a[1] * x;
    a[2] = a[2] * x;
    a[3] = a[3] * x;
    a[4] = a[4] * y;
    a[5] = a[5] * y;
    a[6] = a[6] * y;
    a[7] = a[7] * y;
    a[8] = a[8] * z;
    a[9] = a[9] * z;
    a[10] = a[10] * z;
    a[11] = a[11] * z;
    a[12] = a[12];
    a[13] = a[13];
    a[14] = a[14];
    a[15] = a[15];
    return this;
};

mat4.rotate = function (rad, axis) {
    var a = this.val,
        x = axis.x, y = axis.y, z = axis.z,
        len = Math.sqrt(x * x + y * y + z * z),
        s, c, t,
        a00, a01, a02, a03,
        a10, a11, a12, a13,
        a20, a21, a22, a23,
        b00, b01, b02,
        b10, b11, b12,
        b20, b21, b22;

    if (Math.abs(len) < EPSILON) { return null; }
    
    len = 1 / len;
    x *= len;
    y *= len;
    z *= len;

    s = Math.sin(rad);
    c = Math.cos(rad);
    t = 1 - c;

    a00 = a[0]; a01 = a[1]; a02 = a[2]; a03 = a[3];
    a10 = a[4]; a11 = a[5]; a12 = a[6]; a13 = a[7];
    a20 = a[8]; a21 = a[9]; a22 = a[10]; a23 = a[11];

    // Construct the elements of the rotation matrix
    b00 = x * x * t + c; b01 = y * x * t + z * s; b02 = z * x * t - y * s;
    b10 = x * y * t - z * s; b11 = y * y * t + c; b12 = z * y * t + x * s;
    b20 = x * z * t + y * s; b21 = y * z * t - x * s; b22 = z * z * t + c;

    // Perform rotation-specific matrix multiplication
    a[0] = a00 * b00 + a10 * b01 + a20 * b02;
    a[1] = a01 * b00 + a11 * b01 + a21 * b02;
    a[2] = a02 * b00 + a12 * b01 + a22 * b02;
    a[3] = a03 * b00 + a13 * b01 + a23 * b02;
    a[4] = a00 * b10 + a10 * b11 + a20 * b12;
    a[5] = a01 * b10 + a11 * b11 + a21 * b12;
    a[6] = a02 * b10 + a12 * b11 + a22 * b12;
    a[7] = a03 * b10 + a13 * b11 + a23 * b12;
    a[8] = a00 * b20 + a10 * b21 + a20 * b22;
    a[9] = a01 * b20 + a11 * b21 + a21 * b22;
    a[10] = a02 * b20 + a12 * b21 + a22 * b22;
    a[11] = a03 * b20 + a13 * b21 + a23 * b22;
    return this;
};

mat4.rotateX = function(rad) {
    var a = this.val,
        s = Math.sin(rad),
        c = Math.cos(rad),
        a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7],
        a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11];

    // Perform axis-specific matrix multiplication
    a[4] = a10 * c + a20 * s;
    a[5] = a11 * c + a21 * s;
    a[6] = a12 * c + a22 * s;
    a[7] = a13 * c + a23 * s;
    a[8] = a20 * c - a10 * s;
    a[9] = a21 * c - a11 * s;
    a[10] = a22 * c - a12 * s;
    a[11] = a23 * c - a13 * s;
    return this;
};

mat4.rotateY = function(rad) {
    var a = this.val,
        s = Math.sin(rad),
        c = Math.cos(rad),
        a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3],
        a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11];

    // Perform axis-specific matrix multiplication
    a[0] = a00 * c - a20 * s;
    a[1] = a01 * c - a21 * s;
    a[2] = a02 * c - a22 * s;
    a[3] = a03 * c - a23 * s;
    a[8] = a00 * s + a20 * c;
    a[9] = a01 * s + a21 * c;
    a[10] = a02 * s + a22 * c;
    a[11] = a03 * s + a23 * c;
    return this;
};

mat4.rotateZ = function (rad) {
    var a = this.val,
        s = Math.sin(rad),
        c = Math.cos(rad),
        a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3],
        a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7];

    // Perform axis-specific matrix multiplication
    a[0] = a00 * c + a10 * s;
    a[1] = a01 * c + a11 * s;
    a[2] = a02 * c + a12 * s;
    a[3] = a03 * c + a13 * s;
    a[4] = a10 * c - a00 * s;
    a[5] = a11 * c - a01 * s;
    a[6] = a12 * c - a02 * s;
    a[7] = a13 * c - a03 * s;
    return this;
};

mat4.fromRotationTranslation = function (q, v) {
    // Quaternion math
    var out = this.val,
        x = q.x, y = q.y, z = q.z, w = q.w,
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = v.x;
    out[13] = v.y;
    out[14] = v.z;
    out[15] = 1;
    return this;
};

mat4.fromQuat = function (q) {
    var out = this.val,
        x = q.x, y = q.y, z = q.z, w = q.w,
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;

    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;

    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;

    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;

    return this;
};


/**
 * Generates a frustum matrix with the given bounds
 *
 * @param {Number} left Left bound of the frustum
 * @param {Number} right Right bound of the frustum
 * @param {Number} bottom Bottom bound of the frustum
 * @param {Number} top Top bound of the frustum
 * @param {Number} near Near bound of the frustum
 * @param {Number} far Far bound of the frustum
 * @returns {Matrix4} this for chaining
 */
mat4.frustum = function (left, right, bottom, top, near, far) {
    var out = this.val,
        rl = 1 / (right - left),
        tb = 1 / (top - bottom),
        nf = 1 / (near - far);
    out[0] = (near * 2) * rl;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = (near * 2) * tb;
    out[6] = 0;
    out[7] = 0;
    out[8] = (right + left) * rl;
    out[9] = (top + bottom) * tb;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (far * near * 2) * nf;
    out[15] = 0;
    return this;
};


/**
 * Generates a perspective projection matrix with the given bounds
 *
 * @param {number} fovy Vertical field of view in radians
 * @param {number} aspect Aspect ratio. typically viewport width/height
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {Matrix4} this for chaining
 */
mat4.perspective = function (fovy, aspect, near, far) {
    var out = this.val,
        f = 1.0 / Math.tan(fovy / 2),
        nf = 1 / (near - far);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (2 * far * near) * nf;
    out[15] = 0;
    return this;
};

/**
 * Generates a orthogonal projection matrix with the given bounds
 *
 * @param {number} left Left bound of the frustum
 * @param {number} right Right bound of the frustum
 * @param {number} bottom Bottom bound of the frustum
 * @param {number} top Top bound of the frustum
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {Matrix4} this for chaining
 */
mat4.ortho = function (left, right, bottom, top, near, far) {
    var out = this.val,
        lr = 1 / (left - right),
        bt = 1 / (bottom - top),
        nf = 1 / (near - far);
    out[0] = -2 * lr;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = -2 * bt;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 2 * nf;
    out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
    return this;
};

/**
 * Generates a look-at matrix with the given eye position, focal point, and up axis
 *
 * @param {Vector3} eye Position of the viewer
 * @param {Vector3} center Point the viewer is looking at
 * @param {Vector3} up vec3 pointing up
 * @returns {Matrix4} this for chaining
 */
mat4.lookAt = function (eye, center, up) {
    var out = this.val,

        x0, x1, x2, y0, y1, y2, z0, z1, z2, len,
        eyex = eye.x,
        eyey = eye.y,
        eyez = eye.z,
        upx = up.x,
        upy = up.y,
        upz = up.z,
        centerx = center.x,
        centery = center.y,
        centerz = center.z;

    if (Math.abs(eyex - centerx) < EPSILON &&
        Math.abs(eyey - centery) < EPSILON &&
        Math.abs(eyez - centerz) < EPSILON) {
        return this.identity();
    }

    z0 = eyex - centerx;
    z1 = eyey - centery;
    z2 = eyez - centerz;

    len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
    z0 *= len;
    z1 *= len;
    z2 *= len;

    x0 = upy * z2 - upz * z1;
    x1 = upz * z0 - upx * z2;
    x2 = upx * z1 - upy * z0;
    len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (!len) {
        x0 = 0;
        x1 = 0;
        x2 = 0;
    } else {
        len = 1 / len;
        x0 *= len;
        x1 *= len;
        x2 *= len;
    }

    y0 = z1 * x2 - z2 * x1;
    y1 = z2 * x0 - z0 * x2;
    y2 = z0 * x1 - z1 * x0;

    len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
    if (!len) {
        y0 = 0;
        y1 = 0;
        y2 = 0;
    } else {
        len = 1 / len;
        y0 *= len;
        y1 *= len;
        y2 *= len;
    }

    out[0] = x0;
    out[1] = y0;
    out[2] = z0;
    out[3] = 0;
    out[4] = x1;
    out[5] = y1;
    out[6] = z1;
    out[7] = 0;
    out[8] = x2;
    out[9] = y2;
    out[10] = z2;
    out[11] = 0;
    out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
    out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
    out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
    out[15] = 1;

    return this;
};


mat4.mul = mat4.multiply;

mat4.idt = mat4.identity;

//This is handy for Pool utilities, to "reset" a
//shared object to its default state
mat4.reset = mat4.idt;

mat4.toString = function () {
    var a = this.val;
    return 'Matrix4(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ', ' +
                    a[4] + ', ' + a[5] + ', ' + a[6] + ', ' + a[7] + ', ' +
                    a[8] + ', ' + a[9] + ', ' + a[10] + ', ' + a[11] + ', ' + 
                    a[12] + ', ' + a[13] + ', ' + a[14] + ', ' + a[15] + ')';
};

mat4.str = mat4.toString;

module.exports = Matrix4;

},{}],27:[function(require,module,exports){
var Vector3 = require('./Vector3');
var Matrix3 = require('./Matrix3');
var common = require('./common');

//some shared 'private' arrays
var s_iNext = (typeof Int8Array !== 'undefined' ? new Int8Array([1,2,0]) : [1,2,0]);
var tmp = (typeof Float32Array !== 'undefined' ? new Float32Array([0,0,0]) : [0,0,0]);

var xUnitVec3 = new Vector3(1, 0, 0);
var yUnitVec3 = new Vector3(0, 1, 0);
var tmpvec = new Vector3();

var tmpMat3 = new Matrix3();

function Quaternion(x, y, z, w) {
	if (typeof x === "object") {
        this.x = x.x||0;
        this.y = x.y||0;
        this.z = x.z||0;
        this.w = x.w||0;
    } else {
        this.x = x||0;
        this.y = y||0;
        this.z = z||0;
        this.w = w||0;
    }
}

var quat = Quaternion.prototype;

//mixin common functions
for (var k in common) {
    quat[k] = common[k];
}

quat.rotationTo = function(a, b) {
    var dot = a.x * b.x + a.y * b.y + a.z * b.z; //a.dot(b)
    if (dot < -0.999999) {
        if (tmpvec.copy(xUnitVec3).cross(a).len() < 0.000001)
            tmpvec.copy(yUnitVec3).cross(a);
        
        tmpvec.normalize();
        return this.setAxisAngle(tmpvec, Math.PI);
    } else if (dot > 0.999999) {
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.w = 1;
        return this;
    } else {
        tmpvec.copy(a).cross(b);
        this.x = tmpvec.x;
        this.y = tmpvec.y;
        this.z = tmpvec.z;
        this.w = 1 + dot;
        return this.normalize();
    }
};

quat.setAxes = function(view, right, up) {
    var m = tmpMat3.val;
    m[0] = right.x;
    m[3] = right.y;
    m[6] = right.z;

    m[1] = up.x;
    m[4] = up.y;
    m[7] = up.z;

    m[2] = -view.x;
    m[5] = -view.y;
    m[8] = -view.z;

    return this.fromMat3(tmpMat3).normalize();
};

quat.identity = function() {
    this.x = this.y = this.z = 0;
    this.w = 1;
    return this;
};

quat.setAxisAngle = function(axis, rad) {
    rad = rad * 0.5;
    var s = Math.sin(rad);
    this.x = s * axis.x;
    this.y = s * axis.y;
    this.z = s * axis.z;
    this.w = Math.cos(rad);
    return this;
};

quat.multiply = function(b) {
    var ax = this.x, ay = this.y, az = this.z, aw = this.w,
        bx = b.x, by = b.y, bz = b.z, bw = b.w;

    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
};

quat.slerp = function (b, t) {
    // benchmarks:
    //    http://jsperf.com/quaternion-slerp-implementations

    var ax = this.x, ay = this.y, az = this.y, aw = this.y,
        bx = b.x, by = b.y, bz = b.z, bw = b.w;

    var        omega, cosom, sinom, scale0, scale1;

    // calc cosine
    cosom = ax * bx + ay * by + az * bz + aw * bw;
    // adjust signs (if necessary)
    if ( cosom < 0.0 ) {
        cosom = -cosom;
        bx = - bx;
        by = - by;
        bz = - bz;
        bw = - bw;
    }
    // calculate coefficients
    if ( (1.0 - cosom) > 0.000001 ) {
        // standard case (slerp)
        omega  = Math.acos(cosom);
        sinom  = Math.sin(omega);
        scale0 = Math.sin((1.0 - t) * omega) / sinom;
        scale1 = Math.sin(t * omega) / sinom;
    } else {        
        // "from" and "to" quaternions are very close 
        //  ... so we can do a linear interpolation
        scale0 = 1.0 - t;
        scale1 = t;
    }
    // calculate final values
    this.x = scale0 * ax + scale1 * bx;
    this.y = scale0 * ay + scale1 * by;
    this.z = scale0 * az + scale1 * bz;
    this.w = scale0 * aw + scale1 * bw;
    return this;
};

quat.invert = function() {
    var a0 = this.x, a1 = this.y, a2 = this.z, a3 = this.w,
        dot = a0*a0 + a1*a1 + a2*a2 + a3*a3,
        invDot = dot ? 1.0/dot : 0;
    
    // TODO: Would be faster to return [0,0,0,0] immediately if dot == 0

    this.x = -a0*invDot;
    this.y = -a1*invDot;
    this.z = -a2*invDot;
    this.w = a3*invDot;
    return this;
};

quat.conjugate = function() {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
};

quat.rotateX = function (rad) {
    rad *= 0.5; 

    var ax = this.x, ay = this.y, az = this.z, aw = this.w,
        bx = Math.sin(rad), bw = Math.cos(rad);

    this.x = ax * bw + aw * bx;
    this.y = ay * bw + az * bx;
    this.z = az * bw - ay * bx;
    this.w = aw * bw - ax * bx;
    return this;
};

quat.rotateY = function (rad) {
    rad *= 0.5; 

    var ax = this.x, ay = this.y, az = this.z, aw = this.w,
        by = Math.sin(rad), bw = Math.cos(rad);

    this.x = ax * bw - az * by;
    this.y = ay * bw + aw * by;
    this.z = az * bw + ax * by;
    this.w = aw * bw - ay * by;
    return this;
};

quat.rotateZ = function (rad) {
    rad *= 0.5; 

    var ax = this.x, ay = this.y, az = this.z, aw = this.w,
        bz = Math.sin(rad), bw = Math.cos(rad);

    this.x = ax * bw + ay * bz;
    this.y = ay * bw - ax * bz;
    this.z = az * bw + aw * bz;
    this.w = aw * bw - az * bz;
    return this;
};

quat.calculateW = function () {
    var x = this.x, y = this.y, z = this.z;

    this.x = x;
    this.y = y;
    this.z = z;
    this.w = -Math.sqrt(Math.abs(1.0 - x * x - y * y - z * z));
    return this;
};

quat.fromMat3 = function(mat) {
    // benchmarks:
    //    http://jsperf.com/typed-array-access-speed
    //    http://jsperf.com/conversion-of-3x3-matrix-to-quaternion

    // Algorithm in Ken Shoemake's article in 1987 SIGGRAPH course notes
    // article "Quaternion Calculus and Fast Animation".
    var m = mat.val,
        fTrace = m[0] + m[4] + m[8];
    var fRoot;

    if ( fTrace > 0.0 ) {
        // |w| > 1/2, may as well choose w > 1/2
        fRoot = Math.sqrt(fTrace + 1.0);  // 2w
        this.w = 0.5 * fRoot;
        fRoot = 0.5/fRoot;  // 1/(4w)
        this.x = (m[7]-m[5])*fRoot;
        this.y = (m[2]-m[6])*fRoot;
        this.z = (m[3]-m[1])*fRoot;
    } else {
        // |w| <= 1/2
        var i = 0;
        if ( m[4] > m[0] )
          i = 1;
        if ( m[8] > m[i*3+i] )
          i = 2;
        var j = s_iNext[i];
        var k = s_iNext[j];
            
        //This isn't quite as clean without array access...
        fRoot = Math.sqrt(m[i*3+i]-m[j*3+j]-m[k*3+k] + 1.0);
        tmp[i] = 0.5 * fRoot;

        fRoot = 0.5 / fRoot;
        tmp[j] = (m[j*3+i] + m[i*3+j]) * fRoot;
        tmp[k] = (m[k*3+i] + m[i*3+k]) * fRoot;

        this.x = tmp[0];
        this.y = tmp[1];
        this.z = tmp[2];
        this.w = (m[k*3+j] - m[j*3+k]) * fRoot;
    }
    
    return this;
};

quat.idt = quat.identity;

quat.sub = quat.subtract;

quat.mul = quat.multiply;

quat.len = quat.length;

quat.lenSq = quat.lengthSq;

//This is handy for Pool utilities, to "reset" a
//shared object to its default state
quat.reset = quat.idt;


quat.toString = function() {
    return 'Quaternion(' + this.x + ', ' + this.y + ', ' + this.z + ', ' + this.w + ')';
};

quat.str = quat.toString;

module.exports = Quaternion;
},{"./Matrix3":25,"./Vector3":29,"./common":31}],28:[function(require,module,exports){
function Vector2(x, y) {
	if (typeof x === "object") {
        this.x = x.x||0;
        this.y = x.y||0;
    } else {
        this.x = x||0;
        this.y = y||0;
    }
}

//shorthand it for better minification
var vec2 = Vector2.prototype;

/**
 * Returns a new instance of Vector2 with
 * this vector's components. 
 * @return {Vector2} a clone of this vector
 */
vec2.clone = function() {
    return new Vector2(this.x, this.y);
};

/**
 * Copies the x, y components from the specified
 * Vector. Any undefined components from `otherVec`
 * will default to zero.
 * 
 * @param  {otherVec} the other Vector2 to copy
 * @return {Vector2}  this, for chaining
 */
vec2.copy = function(otherVec) {
    this.x = otherVec.x||0;
    this.y = otherVec.y||0;
    return this;
};

/**
 * A convenience function to set the components of
 * this vector as x and y. Falsy or undefined
 * parameters will default to zero.
 *
 * You can also pass a vector object instead of
 * individual components, to copy the object's components.
 * 
 * @param {Number} x the x component
 * @param {Number} y the y component
 * @return {Vector2}  this, for chaining
 */
vec2.set = function(x, y) {
    if (typeof x === "object") {
        this.x = x.x||0;
        this.y = x.y||0;
    } else {
        this.x = x||0;
        this.y = y||0;
    }
    return this;
};

vec2.add = function(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
};

vec2.subtract = function(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
};

vec2.multiply = function(v) {
    this.x *= v.x;
    this.y *= v.y;
    return this;
};

vec2.scale = function(s) {
    this.x *= s;
    this.y *= s;
    return this;
};

vec2.divide = function(v) {
    this.x /= v.x;
    this.y /= v.y;
    return this;
};

vec2.negate = function() {
    this.x = -this.x;
    this.y = -this.y;
    return this;
};

vec2.distance = function(v) {
    var dx = v.x - this.x,
        dy = v.y - this.y;
    return Math.sqrt(dx*dx + dy*dy);
};

vec2.distanceSq = function(v) {
    var dx = v.x - this.x,
        dy = v.y - this.y;
    return dx*dx + dy*dy;
};

vec2.length = function() {
    var x = this.x,
        y = this.y;
    return Math.sqrt(x*x + y*y);
};

vec2.lengthSq = function() {
    var x = this.x,
        y = this.y;
    return x*x + y*y;
};

vec2.normalize = function() {
    var x = this.x,
        y = this.y;
    var len = x*x + y*y;
    if (len > 0) {
        len = 1 / Math.sqrt(len);
        this.x = x*len;
        this.y = y*len;
    }
    return this;
};

vec2.dot = function(v) {
    return this.x * v.x + this.y * v.y;
};

//Unlike Vector3, this returns a scalar
//http://allenchou.net/2013/07/cross-product-of-2d-vectors/
vec2.cross = function(v) {
    return this.x * v.y - this.y * v.x;
};

vec2.lerp = function(v, t) {
    var ax = this.x,
        ay = this.y;
    t = t||0;
    this.x = ax + t * (v.x - ax);
    this.y = ay + t * (v.y - ay);
    return this;
};

vec2.transformMat3 = function(mat) {
    var x = this.x, y = this.y, m = mat.val;
    this.x = m[0] * x + m[3] * y + m[6];
    this.y = m[1] * x + m[4] * y + m[7];
    return this;
};

vec2.transformMat4 = function(mat) {
    var x = this.x, 
        y = this.y,
        m = mat.val;
    this.x = m[0] * x + m[4] * y + m[12];
    this.y = m[1] * x + m[5] * y + m[13];
    return this;
};

vec2.reset = function() {
    this.x = 0;
    this.y = 0;
    return this;
};

vec2.sub = vec2.subtract;

vec2.mul = vec2.multiply;

vec2.div = vec2.divide;

vec2.dist = vec2.distance;

vec2.distSq = vec2.distanceSq;

vec2.len = vec2.length;

vec2.lenSq = vec2.lengthSq;

vec2.toString = function() {
    return 'Vector2(' + this.x + ', ' + this.y + ')';
};

vec2.random = function(scale) {
    scale = scale || 1.0;
    var r = Math.random() * 2.0 * Math.PI;
    this.x = Math.cos(r) * scale;
    this.y = Math.sin(r) * scale;
    return this;
};

vec2.str = vec2.toString;

module.exports = Vector2;
},{}],29:[function(require,module,exports){
function Vector3(x, y, z) {
    if (typeof x === "object") {
        this.x = x.x||0;
        this.y = x.y||0;
        this.z = x.z||0;
    } else {
        this.x = x||0;
        this.y = y||0;
        this.z = z||0;
    }
}

//shorthand it for better minification
var vec3 = Vector3.prototype;

vec3.clone = function() {
    return new Vector3(this.x, this.y, this.z);
};

vec3.copy = function(otherVec) {
    this.x = otherVec.x;
    this.y = otherVec.y;
    this.z = otherVec.z;
    return this;
};

vec3.set = function(x, y, z) {
    if (typeof x === "object") {
        this.x = x.x||0;
        this.y = x.y||0;
        this.z = x.z||0;
    } else {
        this.x = x||0;
        this.y = y||0;
        this.z = z||0;
    }
    return this;
};

vec3.add = function(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
};

vec3.subtract = function(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
};

vec3.multiply = function(v) {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
};

vec3.scale = function(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
};

vec3.divide = function(v) {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    return this;
};

vec3.negate = function() {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
};

vec3.distance = function(v) {
    var dx = v.x - this.x,
        dy = v.y - this.y,
        dz = v.z - this.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
};

vec3.distanceSq = function(v) {
    var dx = v.x - this.x,
        dy = v.y - this.y,
        dz = v.z - this.z;
    return dx*dx + dy*dy + dz*dz;
};

vec3.length = function() {
    var x = this.x,
        y = this.y,
        z = this.z;
    return Math.sqrt(x*x + y*y + z*z);
};

vec3.lengthSq = function() {
    var x = this.x,
        y = this.y,
        z = this.z;
    return x*x + y*y + z*z;
};

vec3.normalize = function() {
    var x = this.x,
        y = this.y,
        z = this.z;
    var len = x*x + y*y + z*z;
    if (len > 0) {
        len = 1 / Math.sqrt(len);
        this.x = x*len;
        this.y = y*len;
        this.z = z*len;
    }
    return this;
};

vec3.dot = function(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
};

vec3.cross = function(v) {
    var ax = this.x, ay = this.y, az = this.z,
        bx = v.x, by = v.y, bz = v.z;

    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
};

vec3.lerp = function(v, t) {
    var ax = this.x,
        ay = this.y,
        az = this.z;
    t = t||0;
    this.x = ax + t * (v.x - ax);
    this.y = ay + t * (v.y - ay);
    this.z = az + t * (v.z - az);
    return this;
};

vec3.transformMat4 = function(mat) {
    var x = this.x, y = this.y, z = this.z, m = mat.val;
    this.x = m[0] * x + m[4] * y + m[8] * z + m[12];
    this.y = m[1] * x + m[5] * y + m[9] * z + m[13];
    this.z = m[2] * x + m[6] * y + m[10] * z + m[14];
    return this;
};

vec3.transformMat3 = function(mat) {
    var x = this.x, y = this.y, z = this.z, m = mat.val;
    this.x = x * m[0] + y * m[3] + z * m[6];
    this.y = x * m[1] + y * m[4] + z * m[7];
    this.z = x * m[2] + y * m[5] + z * m[8];
    return this;
};

vec3.transformQuat = function(q) {
    // benchmarks: http://jsperf.com/quaternion-transform-vec3-implementations
    var x = this.x, y = this.y, z = this.z,
        qx = q.x, qy = q.y, qz = q.z, qw = q.w,

        // calculate quat * vec
        ix = qw * x + qy * z - qz * y,
        iy = qw * y + qz * x - qx * z,
        iz = qw * z + qx * y - qy * x,
        iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
};

/**
 * Multiplies this Vector3 by the specified matrix, 
 * applying a W divide. This is useful for projection,
 * e.g. unprojecting a 2D point into 3D space.
 *
 * @method  prj
 * @param {Matrix4} the 4x4 matrix to multiply with 
 * @return {Vector3} this object for chaining
 */
vec3.project = function(mat) {
    var x = this.x,
        y = this.y,
        z = this.z,
        m = mat.val,
        a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3],
        a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
        a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11],
        a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

    var l_w = 1 / (x * a03 + y * a13 + z * a23 + a33);

    this.x = (x * a00 + y * a10 + z * a20 + a30) * l_w; 
    this.y = (x * a01 + y * a11 + z * a21 + a31) * l_w; 
    this.z = (x * a02 + y * a12 + z * a22 + a32) * l_w;
    return this;
};

/**
 * Unproject this point from 2D space to 3D space.
 * The point should have its x and y properties set to
 * 2D screen space, and the z either at 0 (near plane)
 * or 1 (far plane). The provided matrix is assumed to already
 * be combined, i.e. projection * view * model.
 *
 * After this operation, this vector's (x, y, z) components will
 * represent the unprojected 3D coordinate.
 * 
 * @param  {Vector4} viewport          screen x, y, width and height in pixels
 * @param  {Matrix4} invProjectionView combined projection and view matrix
 * @return {Vector3}                   this object, for chaining
 */
vec3.unproject = function(viewport, invProjectionView) {
    var viewX = viewport.x,
        viewY = viewport.y,
        viewWidth = viewport.z,
        viewHeight = viewport.w;
    
    var x = this.x, 
        y = this.y,
        z = this.z;

    x = x - viewX;
    y = viewHeight - y - 1;
    y = y - viewY;

    this.x = (2 * x) / viewWidth - 1;
    this.y = (2 * y) / viewHeight - 1;
    this.z = 2 * z - 1;

    return this.project(invProjectionView);
};

vec3.random = function(scale) {
    scale = scale || 1.0;

    var r = Math.random() * 2.0 * Math.PI;
    var z = (Math.random() * 2.0) - 1.0;
    var zScale = Math.sqrt(1.0-z*z) * scale;
    
    this.x = Math.cos(r) * zScale;
    this.y = Math.sin(r) * zScale;
    this.z = z * scale;
    return this;
};

vec3.reset = function() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    return this;
};


vec3.sub = vec3.subtract;

vec3.mul = vec3.multiply;

vec3.div = vec3.divide;

vec3.dist = vec3.distance;

vec3.distSq = vec3.distanceSq;

vec3.len = vec3.length;

vec3.lenSq = vec3.lengthSq;

vec3.toString = function() {
    return 'Vector3(' + this.x + ', ' + this.y + ', ' + this.z + ')';
};

vec3.str = vec3.toString;

module.exports = Vector3;
},{}],30:[function(require,module,exports){
var common = require('./common');

function Vector4(x, y, z, w) {
	if (typeof x === "object") {
        this.x = x.x||0;
        this.y = x.y||0;
        this.z = x.z||0;
        this.w = x.w||0;
    } else {
        this.x = x||0;
        this.y = y||0;
        this.z = z||0;
        this.w = w||0;
    }
}

//shorthand it for better minification
var vec4 = Vector4.prototype;

//mixin common functions
for (var k in common) {
    vec4[k] = common[k];
}

vec4.clone = function() {
    return new Vector4(this.x, this.y, this.z, this.w);
};

vec4.multiply = function(v) {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    this.w *= v.w;
    return this;
};

vec4.divide = function(v) {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    this.w /= v.w;
    return this;
};

vec4.distance = function(v) {
    var dx = v.x - this.x,
        dy = v.y - this.y,
        dz = v.z - this.z,
        dw = v.w - this.w;
    return Math.sqrt(dx*dx + dy*dy + dz*dz + dw*dw);
};

vec4.distanceSq = function(v) {
    var dx = v.x - this.x,
        dy = v.y - this.y,
        dz = v.z - this.z,
        dw = v.w - this.w;
    return dx*dx + dy*dy + dz*dz + dw*dw;
};

vec4.negate = function() {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.w = -this.w;
    return this;
};

vec4.transformMat4 = function(mat) {
    var m = mat.val, x = this.x, y = this.y, z = this.z, w = this.w;
    this.x = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    this.y = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    this.z = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    this.w = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    return this;
};

//// TODO: is this really the same as Vector3 ??
///  Also, what about this:
///  http://molecularmusings.wordpress.com/2013/05/24/a-faster-quaternion-vector-multiplication/
vec4.transformQuat = function(q) {
    // benchmarks: http://jsperf.com/quaternion-transform-vec3-implementations
    var x = this.x, y = this.y, z = this.z,
        qx = q.x, qy = q.y, qz = q.z, qw = q.w,

        // calculate quat * vec
        ix = qw * x + qy * z - qz * y,
        iy = qw * y + qz * x - qx * z,
        iz = qw * z + qx * y - qy * x,
        iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
};

vec4.random = function(scale) {
    scale = scale || 1.0;

    //Not spherical; should fix this for more uniform distribution
    this.x = (Math.random() * 2 - 1) * scale;
    this.y = (Math.random() * 2 - 1) * scale;
    this.z = (Math.random() * 2 - 1) * scale;
    this.w = (Math.random() * 2 - 1) * scale;
    return this;
};

vec4.reset = function() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 0;
    return this;
};

vec4.sub = vec4.subtract;

vec4.mul = vec4.multiply;

vec4.div = vec4.divide;

vec4.dist = vec4.distance;

vec4.distSq = vec4.distanceSq;

vec4.len = vec4.length;

vec4.lenSq = vec4.lengthSq;

vec4.toString = function() {
    return 'Vector4(' + this.x + ', ' + this.y + ', ' + this.z + ', ' + this.w + ')';
};

vec4.str = vec4.toString;

module.exports = Vector4;
},{"./common":31}],31:[function(require,module,exports){
//common vec4 functions
module.exports = {
    
/**
 * Copies the x, y, z, w components from the specified
 * Vector. Unlike most other operations, this function
 * will default undefined components on `otherVec` to zero.
 * 
 * @method  copy
 * @param  {otherVec} the other Vector4 to copy
 * @return {Vector}  this, for chaining
 */


/**
 * A convenience function to set the components of
 * this vector as x, y, z, w. Falsy or undefined
 * parameters will default to zero.
 *
 * You can also pass a vector object instead of
 * individual components, to copy the object's components.
 * 
 * @method  set
 * @param {Number} x the x component
 * @param {Number} y the y component
 * @param {Number} z the z component
 * @param {Number} w the w component
 * @return {Vector2}  this, for chaining
 */

/**
 * Adds the components of the other Vector4 to
 * this vector.
 * 
 * @method add
 * @param  {Vector4} otherVec other vector, right operand
 * @return {Vector2}  this, for chaining
 */

/**
 * Subtracts the components of the other Vector4
 * from this vector. Aliased as `sub()`
 * 
 * @method  subtract
 * @param  {Vector4} otherVec other vector, right operand
 * @return {Vector2}  this, for chaining
 */

/**
 * Multiplies the components of this Vector4
 * by a scalar amount.
 *
 * @method  scale
 * @param {Number} s the scale to multiply by
 * @return {Vector4} this, for chaining
 */

/**
 * Returns the magnitude (length) of this vector.
 *
 * Aliased as `len()`
 * 
 * @method  length
 * @return {Number} the length of this vector
 */

/**
 * Returns the squared magnitude (length) of this vector.
 *
 * Aliased as `lenSq()`
 * 
 * @method  lengthSq
 * @return {Number} the squared length of this vector
 */

/**
 * Normalizes this vector to a unit vector.
 * @method normalize
 * @return {Vector4}  this, for chaining
 */

/**
 * Returns the dot product of this vector
 * and the specified Vector4.
 * 
 * @method dot
 * @return {Number} the dot product
 */
    copy: function(otherVec) {
        this.x = otherVec.x||0;
        this.y = otherVec.y||0;
        this.z = otherVec.z||0;
        this.w = otherVec.w||0;
        return this;
    },

    set: function(x, y, z, w) {
        if (typeof x === "object") {
            this.x = x.x||0;
            this.y = x.y||0;
            this.z = x.z||0;
            this.w = x.w||0;
        } else {
            this.x = x||0;
            this.y = y||0;
            this.z = z||0;
            this.w = w||0;

        }
        return this;
    },

    add: function(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        this.w += v.w;
        return this;
    },

    subtract: function(v) {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        this.w -= v.w;
        return this;
    },

    scale: function(s) {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        this.w *= s;
        return this;
    },


    length: function() {
        var x = this.x,
            y = this.y,
            z = this.z,
            w = this.w;
        return Math.sqrt(x*x + y*y + z*z + w*w);
    },

    lengthSq: function() {
        var x = this.x,
            y = this.y,
            z = this.z,
            w = this.w;
        return x*x + y*y + z*z + w*w;
    },

    normalize: function() {
        var x = this.x,
            y = this.y,
            z = this.z,
            w = this.w;
        var len = x*x + y*y + z*z + w*w;
        if (len > 0) {
            len = 1 / Math.sqrt(len);
            this.x = x*len;
            this.y = y*len;
            this.z = z*len;
            this.w = w*len;
        }
        return this;
    },

    dot: function(v) {
        return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
    },

    lerp: function(v, t) {
        var ax = this.x,
            ay = this.y,
            az = this.z,
            aw = this.w;
        t = t||0;
        this.x = ax + t * (v.x - ax);
        this.y = ay + t * (v.y - ay);
        this.z = az + t * (v.z - az);
        this.w = aw + t * (v.w - aw);
        return this;
    }
};
},{}],32:[function(require,module,exports){
module.exports = {
    Vector2: require('./Vector2'),
    Vector3: require('./Vector3'),
    Vector4: require('./Vector4'),
    Matrix3: require('./Matrix3'),
    Matrix4: require('./Matrix4'),
    Quaternion: require('./Quaternion')
};
},{"./Matrix3":25,"./Matrix4":26,"./Quaternion":27,"./Vector2":28,"./Vector3":29,"./Vector4":30}]},{},[1])