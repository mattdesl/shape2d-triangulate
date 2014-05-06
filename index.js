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

        if (set.length < 3)
            continue;

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