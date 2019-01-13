/*
 * webweb makes pretty interactive network diagrams in your browser
 * version 4
 *
 * Daniel Larremore + Contributors
 * August 29, 2018
 * daniel.larremore@colorado.edu
 * http://github.com/dblarremore/webweb
 * Comments and suggestions always welcome.
 *
 */

// Here are default values. 
// If you don't put anything different in the JSON file, this is what you get!
var displayDefaults = {
    'c' : 60, // charge
    'g' : 0.1, // gravity
    'l' : 20, // edge length
    'r' : 5, // node radius
    'linkStrength' : 1,
    'colorPalette' : 'Set1',
    'networkLayer' : 0,
    'metadata' : {},
    'nameToMatch' : "",
};

var display = {};
var networkNames;

var links = [];
var nodes = [];
var scales = {};
var node, simulation, link;

var nodePersistence = [];

var colorData = {
    'type' : 'none',
    'scaledValues' : [],
    'rawValues' : [],
    'metadata' : {},
    'categoryNames' : [],
};

var sizeData = {
    'type' : 'none',
    'scaledValues' : [],
    'rawValues' : [],
    'metadata' : {},
    'R' : 0,
};

////////////////////////////////////////////////////////////////////////////////
// initializeWebweb
//
// run once on startup
//
// - loads webweb data
// - standardizes its representation
// - sets up the scales
// - initializes the webweb html
// - computes and draws nodes
////////////////////////////////////////////////////////////////////////////////
function initializeWebweb() {
    networkNames = Object.keys(wwdata.networks);

    // default the network to display to the first in networks list
    displayDefaults['networkName'] = networkNames[0];

    display = wwdata.display;
    for (var key in displayDefaults) {
        if (display[key] == undefined) {
            display[key] = displayDefaults[key];
        }
    }

    // don't allow freezeNodeMovement to be true unless we have node coordinates
    if (display.nodeCoordinates == undefined) {
        display.freezeNodeMovement = false;
    }

    standardizeRepresentation();

    scales = {
        'nodeSize' : d3.scaleLinear().range([1, 1]),
        'colors' : {
            'scalar' : d3.scaleLinear().range([1, 1]),
            'categorical' : d3.scaleOrdinal().range([1, 1]),
        },
        'links' : {
            'width' : d3.scaleLinear().range([1, 1]),
            'opacity' : d3.scaleLinear().range([0.4, 0.9]),
        },
    }

    initializeHTML();

    computeNodes();
    drawNodes();

    simulation = d3.forceSimulation(nodes)
        .force("center", d3.forceCenter(display.w / 2, display.h / 2))
        .on('tick', tick);

    displayNetwork();
}
function initializeHTML() {
    var container;

    if (display.attachWebwebToElementWithId == undefined) {
        var container = document.createElement('div')
        container.setAttribute('id', 'webweb-center');

        document.getElementsByTagName("body")[0].appendChild(container);
    }
    else {
        container = document.getElementById(display.attachWebwebToElementWithId);
    }

    writeMenus(container);
    writeVisualization(container);
}
function writeVisualization(container) {
    var visualizationContainer = document.createElement("div");
    visualizationContainer.setAttribute('id', 'webweb-visualization-container');

    container.appendChild(visualizationContainer);

    if (display.w == undefined) {
        var heuristic = container.clientWidth - 3 * 20;

        if (heuristic <= 0) {
            heuristic = 1000;
        }
        display.w = Math.min.apply(null, [heuristic, 1000]);
    }

    if (display.h == undefined) {
        var heuristic = container.clientHeight - 3 * 20;

        if (heuristic <= 0) {
            heuristic = 600;
        }

        display.h = Math.min.apply(null, [heuristic, 600, display.w]);
    }
    vis = d3.select("#webweb-visualization-container")
        .append("svg")
        .attr("width", display.w)
        .attr("height", display.h)
        .attr("id", "vis");
}
function standardizeRepresentation() {
    for (var i in networkNames) {
        standardizeNetworkRepresentation(networkNames[i]);
    }

    display.nodes = addMetadataVectorsToNodes(display.metadata, display.nodes);
}
function standardizeNetworkRepresentation(networkName) {
    var network = wwdata.networks[networkName];

    if (network.layers == undefined) {
        network.layers = [
            {
                'edgeList' : network.edgeList,
                'nodes' : network.nodes,
                'metadata' : network.metadata,
            }
        ];
    }

    for (var i in network.layers) {
        network.layers[i] = standardizeLayerRepresentation(network.layers[i]);
    }

    wwdata.networks[networkName] = network;
}
function standardizeLayerRepresentation(layer) {
    if (layer.metadata !== undefined) {
        for (var metadatum in layer.metadata) {
            if (display.metadata[metadatum] == undefined) {
                display.metadata[metadatum] = {};
            }

            if (layer.metadata[metadatum].categories !== undefined) {
                display.metadata[metadatum]['categories'] = layer.metadata[metadatum].categories;
            }

            if (layer.metadata[metadatum].type !== undefined) {
                display.metadata[metadatum]['type'] = layer.metadata[metadatum].type;

            }

        }

        layer.nodes = addMetadataVectorsToNodes(layer.metadata, layer.nodes);
    }

    return layer;
}
function addMetadataVectorsToNodes(metadata, nodes) {
    if (nodes == undefined) {
        nodes = {};
    }

    for (var metadatum in metadata) {
        for (var i in metadata[metadatum].values) {
            if (nodes[i] == undefined) {
                nodes[i] = {};
            }
        
            nodes[i][metadatum] = metadata[metadatum].values[i];
        }
    }

    return nodes;
}
////////////////////////////////////////////////////////////////////////////////
// - changes the number of visible nodes
// - adds metadata to nodes
// - computes links
// - draws links
// - uses the force (luke)
////////////////////////////////////////////////////////////////////////////////
function displayNetwork() {
    setVisibleNodes();
    setNodeMetadata();

    computeLinks();
    drawLinks();

    updateChargeForce();
    updateLinkForce();
    updateGravityForce();

    toggleFreezeNodes(display.freezeNodeMovement);
    toggleInvertBinary(display[getBinaryInversionAttributeForType('color')], 'color')
    toggleInvertBinary(display[getBinaryInversionAttributeForType('size')], 'size')

    // if we've frozen node movement manually tick so new edges are evaluated.
    if (display.freezeNodeMovement) {
        tick();
    }

    // change the display of the layers widget
    setNetworkLayerMenuVisibility();

    computeColors();
    computeSizes();
    computeLegend();
    redrawLinks();
    redrawNodes();
    redisplayNodeNames();
}

////////////////////////////////////////////////////////////////////////////////
// adds/removes nodes from the visualization
//
// it currently only handles removing from the end.
// however, we would like to be able to do this by name (i.e. id).
////////////////////////////////////////////////////////////////////////////////
function setVisibleNodes() {
    var networkNodes = wwdata.networks[display.networkName].layers[display.networkLayer].nodes;

    var nodeCount = getObjetPropertyCount(networkNodes);

    if (nodeCount) {
        if (nodeCount < nodes.length) {
            while (nodeCount != nodes.length) {
                var toRemove = nodes.pop();
                var drawnNode = document.getElementById("node_" + toRemove.idx)
                document.getElementById("vis").removeChild(drawnNode);
                nodePersistence.push({ 'node' : toRemove, 'toDraw' : drawnNode });
            }
        }
        else if (nodeCount > nodes.length) {
            while (nodeCount != nodes.length) {
                var toAdd = nodePersistence.pop();
                document.getElementById("vis").appendChild(toAdd.toDraw);
                nodes.push(toAdd.node);
            }
        }
    }
    else if (display.N > nodes.length) {
        // otherwise, if we don't have a set number of nodes, reset the number
        // of nodes to the maximum
        while (nodes.length != display.N) {
            var toAdd = nodePersistence.pop();
            document.getElementById("vis").appendChild(toAdd.toDraw);
            nodes.push(toAdd.node);
        }
    }
}
function addNodeMetadata(metadata, nodeIdMap) {
    if (getObjetPropertyCount(metadata) == 0) {
        return;
    }

    for (var i in metadata) {
        for (var metadatum in metadata[i]) {
            nodes[nodeIdMap[i]][metadatum] = metadata[i][metadatum];
        }
    }
}
function getNetworkData(networkName, networkLayer) {
    return wwdata.networks[networkName].layers[networkLayer];
}
////////////////////////////////////////////////////////////////////////////////
// creates a map from observed nodes (nodes in the edge list, display.nodes, and
// the current layer's nodes) to an internal "id"
////////////////////////////////////////////////////////////////////////////////
function getNodeIdMap(networkName, networkLayer) {
    var networkData = getNetworkData(networkName, networkLayer);

    var nodeNames = [];

    for (var i in networkData.edgeList) {
        nodeNames.push(networkData.edgeList[i][0]);
        nodeNames.push(networkData.edgeList[i][1]);
    }

    if (getObjetPropertyCount(display.nodes) > 0) {
        for (var i in display.nodes) {
            var _id = isNaN(i) ? i : +i;
            nodeNames.push(_id);
        }
    }

    if (getObjetPropertyCount(networkData.nodes) > 0) {
        for (var i in networkData.nodes) {
            var _id = isNaN(i) ? i : +i;
            nodeNames.push(_id);
        }
    }

    var unusedId = 0;
    var nodeIdMap = {};
    for (var i in nodeNames) {
        var name = nodeNames[i];
        if (nodeIdMap[name] == undefined) {
            nodeIdMap[name] = unusedId;
            unusedId += 1;
        }
    }

    return nodeIdMap;
}
////////////////////////////////////////////////////////////////////////////////
// loads the metadata up from the places they could come from:
// 1. the defaults (none, degree)
// 2. the display parameters
// 3. the network itself
//
// Priority is given to the network's metadata, then display, then defaults
////////////////////////////////////////////////////////////////////////////////
function setNodeMetadata() {
    var allMetadata = {
        'none' : {
            'type' : 'none',
        },
        'degree' : {
            'type' : 'scalar',
        },
    };

    var nonMetadataKeys = [ 'idx', 'fx', 'fy', 'x', 'y', 'vx', 'vy', 'index', 'degree' ];

    // reset node data
    for (var i in nodes) {
        for (var key in nodes[i]) {
            if (nonMetadataKeys.indexOf(key) < 0) {
                delete nodes[i][key];
            }
            else if (key == 'degree' || key == 'strength') {
                // reset the degree and strength (strength not yet supported)
                nodes[i][key] = 0;
            }
        }
    }

    var nodeIdMap = getNodeIdMap(display.networkName, display.networkLayer);

    addNodeMetadata(display.nodes, nodeIdMap);

    var networkData = wwdata.networks[display.networkName].layers[display.networkLayer];
    addNodeMetadata(networkData.nodes, nodeIdMap);

    var nodeNameMap = {};
    for(var key in nodeIdMap){
        nodeNameMap[nodeIdMap[key]] = key;
    }

    // now we need to define the set of metadata
    for (var i in nodes) {
        var node = nodes[i];
        for (var key in node) {
            if (nonMetadataKeys.indexOf(key) < 0) {
                allMetadata[key] = {};

                if (display.metadata !== undefined && display.metadata[key] !== undefined) {
                    // if we have categories, change the node values here
                    if (display.metadata[key].categories !== undefined) {
                        var nodeCategoryNumber = nodes[i][key];
                        nodes[i][key] = display.metadata[key].categories[nodeCategoryNumber];

                    }
                }
            }
        }

        // if we don't already have node names, use the mapping to assign them
        if (nodes[i]['name'] == undefined && nodeNameMap !== undefined) {
            nodes[i]['name'] = nodeNameMap[nodes[i].idx]
        }
    }

    sizeData.metadata = {};
    colorData.metadata = {};
    for (metadatum in allMetadata) {
        if (allMetadata[metadatum].type == undefined) {
            allMetadata[metadatum].type = getMetadatumType(metadatum);
        }

        if (allMetadata[metadatum].type !== "categorical") {
            sizeData.metadata[metadatum] = allMetadata[metadatum];

        }
        colorData.metadata[metadatum] = allMetadata[metadatum];
    }

    // these below if statements are only here because of poor design (says
    // hunter, the designer of this bit)
    // really, computeSizes and computeColors should already have this
    // information.
    if (display.colorBy !== undefined && display.colorBy !== 'none') {
        if (allMetadata !== undefined && allMetadata[display.colorBy] == undefined) {
            display.colorBy = 'none';
        }

        colorData.type = allMetadata[display.colorBy].type;
    }

    if (display.sizeBy !== undefined && display.sizeBy !== 'none') {
        if (allMetadata !== undefined && allMetadata[display.sizeBy] == undefined) {
            display.sizeBy = 'none';
        }

        sizeData.type = allMetadata[display.sizeBy].type;
    }

    // update the menus with these new metadata
    updateSizeMenu();
    updateColorMenu();
}
////////////////////////////////////////////////////////////////////////////////
// tries to figure out the metadatum type of a given metadatum.
////////////////////////////////////////////////////////////////////////////////
function getMetadatumType(metadatum) {
    if (metadatum == 'none') {
        return;
    }

    var metadatumValues = [];
    for (var i in nodes) {
        metadatumValues.push(nodes[i][metadatum]);
    }
    
    var q = d3.set(metadatumValues).values().sort();

    // check if this is a binary relation
    if (q.length == 2 && q[0] == 'false' && q[1] == 'true') {
        return 'binary';
    }
    else if (q.length == 1 && (q[0] == 'false' || q[0] == 'true')) {
        return 'binary';
    }
    else if (q.some(isNaN)) {
        return 'categorical';
    }

    return 'scalar';
}
////////////////////////////////////////////////////////////////////////////////
// initialize the nodes (attempting to be smart about the number of them)
////////////////////////////////////////////////////////////////////////////////
function computeNodes() {
    // iterate through the networks and get their node counts
    var nodeCounts = [];
    for (var i in networkNames) {
        var networkName = networkNames[i];
        var network = wwdata.networks[networkName];
        for (var layer in network.layers) {
            var nodeIdMap = getNodeIdMap(networkName, layer);
            var count = getObjetPropertyCount(nodeIdMap);
            nodeCounts.push(count);
        }
    }

    var maxObservedNodeCount = d3.max(nodeCounts);

    // if display.N is undefined, or if it is less than the max number of nodes
    // we've observed, set it to the max observed
    if (display.N == undefined || display.N < maxObservedNodeCount) {
        display.N = maxObservedNodeCount;
    }

    // Define nodes
    nodes = [];
    for (var i = 0; i < display.N; i++) {
        nodes.push({
            "idx" : i,
            "degree" : 0,
            "x" : display.nodeCoordinates !== undefined ? display.nodeCoordinates[i].x : undefined,
            "y" : display.nodeCoordinates !== undefined ? display.nodeCoordinates[i].y : undefined,
        });
    }
}
function getCurrentNetworkLayer() {
    return wwdata.networks[display.networkName].layers[display.networkLayer];
}
////////////////////////////////////////////////////////////////////////////////
// initialize links/edges
//
// - scale link width/opacity
// - calculate node weights/degrees
////////////////////////////////////////////////////////////////////////////////
function computeLinks() {
    links = [];

    var nodeIdMap = getNodeIdMap(display.networkName, display.networkLayer);

    // make a matrix so edges between nodes can only occur once
    var matrix = {}
    for (var i in nodeIdMap) {
        matrix[nodeIdMap[i]] = {};
    }

    // reset the node degrees
    for (var i in nodes) {
        nodes[i].degree = 0;
    }

    var networkData = getNetworkData(display.networkName, display.networkLayer);

    // push all the links to the list: links
    var weights = [];
    for (var i in networkData.edgeList) {
        var edge = networkData.edgeList[i];
        var source = nodeIdMap[edge[0]];
        var target = nodeIdMap[edge[1]];

        // if there's no edge weight, default it to 1
        var weight = edge.length == 3 ? parseFloat(edge[2]) : 1;

        weights.push(weight);
            
        links.push({
            source: source,
            target: target,
            w: weight,
        })

        if (! matrix[source][target]) {
            matrix[source][target] = true;
            matrix[target][source] = true;

            nodes[source].degree += weight;
            nodes[target].degree += weight;
        }
    }

    // scale the link weight and opacity by computing the range (extent) of the
    // edgeList weights.
    scales.links.width.domain(d3.extent(weights));
    scales.links.opacity.domain(d3.extent(weights));

}
////////////////////////////////////////////////////////////////////////////////
// Compute the radius multipliers of the nodes, given the data and chosen parameters
// 
// the 'sizeBy' display parameter determines how we will scale this.
// For example, if sizeBy is None, then the multiplier is 1 (the identity)
// Otherwise, the multiplier can be something else!
////////////////////////////////////////////////////////////////////////////////
function computeSizes() {
    rawValues = [];
    scaledValues = [];

    sizeData.type = display.sizeBy;

    // default to hiding the size binary inversion widget
    changeInvertBinaryWidgetVisibility(false, 'size');

    // set all sizes to 1 if there's no scaling 
    if (display.sizeBy == "none") {
        for (var i in nodes) {
            scaledValues[i] = 1;
        }
    }
    else {
        var metadatum = sizeData.metadata[display.sizeBy];
        sizeData.type = metadatum.type;

        rawValues = getRawNodeValues(display.sizeBy, metadatum.type, 'size');
        for (var i in nodes) {
            scaledValues[i] = rawValues[i];
            // if we're sizing by degree, square root the value
            if (display.sizeBy == "degree") {
                scaledValues[i] = Math.sqrt(scaledValues[i]);
            }
        }

        if (sizeData.type == 'binary') {
            changeInvertBinaryWidgetVisibility(true, 'size');

            // scale between true and false even if we only have one of
            // the two values
            scales.nodeSize.domain(d3.extent([true, false])).range([0.5, 1.5]);
        }
        else {
            scales.nodeSize.domain(d3.extent(scaledValues), d3.max(scaledValues)).range([0.5, 1.5]);
        }

        for (var i in scaledValues) {
            scaledValues[i] = scales.nodeSize(scaledValues[i]);
        }
    }

    sizeData['scaledValues'] = scaledValues;
    sizeData['rawValues'] = rawValues;
}
////////////////////////////////////////////////////////////////////////////////
// computes the colors for the nodes based on the preferences of the user chosen
// in the dropdown menus.
////////////////////////////////////////////////////////////////////////////////
function computeColors() {
    colorData.type = display.colorBy;

    // default to hiding the color palette menu
    changeColorPaletteMenuVisibility(false);

    // default to hiding the color binary inversion widget
    changeInvertBinaryWidgetVisibility(false, 'color');

    // no colors
    if (display.colorBy == "none"){
        // set all nodes to dark grey 100
        for (var i in nodes) { 
            colorData['scaledValues'][i] = d3.rgb(100, 100, 100);
        }
        return
    }

    var metadatum = colorData.metadata[display.colorBy];
    colorData.type = metadatum.type;

    var rawValues = getRawNodeValues(display.colorBy, metadatum.type, 'color');

    categoryValues = [];

    if (colorData.type == 'binary') {
        categoryValues = getBinaryValues('color');
        changeInvertBinaryWidgetVisibility(true, 'color');
    }
    else if (colorData.type == "categorical") {
        // get the category names if it's categorical
        colorData['categoryNames'] = [];

        // if we don't have categories, retrieve them as scalars from the
        // values for the metadatum
        if (metadatum.categories == undefined) {
            colorData['categoryNames'] = d3.set(rawValues).values().sort();
            categoryValues = colorData['categoryNames'];
        }
        else {
            colorData['categoryNames'] = metadatum.categories;

            // Check to see if our categories are numeric or not
            if (isNaN(d3.quantile(rawValues, 0.25))) {
                categoryValues = colorData['categoryNames'].sort();
            }
            else {
                for (var i in colorData['categoryNames']) {
                    categoryValues[i] = i;
                }
            }
        }
    }

    if (categoryValues.length) {
        // if there are fewer than 9 categories, use the colorbrewer
        // TODO:
        // actually check how many colors there are in the user's selected
        // colorbrewer
        // update the list for this...
        if (categoryValues.length <= 9) {
            scales.colors.categorical.domain(categoryValues)
                .range(colorbrewer[display.colorPalette][categoryValues.length]);

            changeColorPaletteMenuVisibility(true);
        }
        else {
            // otherwise, treat like scalars
            colorData.type = "scalarCategorical";

            var unusedNumber = 1;
            var categoriesMap = {};
            for (var i in categoryValues) {
                categoriesMap[categoryValues[i]] = i;
                unusedNumber += 1;
            }

            for (var i in rawValues) {
                rawValues[i] = categoriesMap[rawValues[i]];
            }
        }
    }

    if (colorData.type != 'categorical') {
        scales.colors.scalar.domain(d3.extent(rawValues)).range([0,1]);
    }

    var scaledValues = [];

    // get colors by passing scaled value to colorWheel
    for (var i in nodes) {
        scaledValues[i] = colorWheel(rawValues[i]);
    }

    colorData['rawValues'] = rawValues;
    colorData['scaledValues'] = scaledValues;
}
////////////////////////////////////////////////////////////////////////////////
// returns raw values for:
// - a metadatumName
// - a metadatumType
// - a displayType (color/size)
////////////////////////////////////////////////////////////////////////////////
function getRawNodeValues(metadatumName, metadatumType, displayType) {
    var rawValues = [];
    for (var i in nodes){
        var val = nodes[i][metadatumName];

        if (metadatumType == 'binary') {
            val = getBinaryValue(val, displayType);
        }

        rawValues[i] = val;
    }

    return rawValues;
}
// ColorWheel is a function that takes a node metadatum, like a category or scalar
// and just gets the damn color. But it has to take into account what the 
// current colorData.type is. Basically, this is trying to apply our prefs to colors
function colorWheel(x) {
    if (colorData.type == "categorical") {
        return scales.colors.categorical(x);
    }
    else if (colorData.type == 'binary') {
        return scales.colors.categorical(getBinaryValue(x, 'color'));
    }
    else {
        // Rainbow HSL
        return d3.hsl(210 * (1 - scales.colors.scalar(x)), 0.7, 0.5);
        // Greyscale
        // return [0.8*255*x,0.8*255*x,0.8*255*x];
        // Copper
        // return [255*Math.min(x/0.75,1),0.78*255*x,0.5*255*x];
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
// Menu Interaction
//
//
// These functions are bound to the various menus that we create in the GUI.
// On menu change, one of these will be called. 
////////////////////////////////////////////////////////////////////////////////
function updateNetwork(networkName) {
    var networkSelect = document.getElementById('networkSelect');
    networkSelect.value = networkName;

    display.networkName = networkName;
    displayNetwork();
}
function changeSizes(sizeBy) {
    display.sizeBy = sizeBy;
    computeSizes();
    computeLegend();
    redrawNodes();
    if (display.nameToMatch != "") {
        matchNodes(display.nameToMatch);
    };
}
function changeColors(colorBy) {
    display.colorBy = colorBy;
    computeColors();
    computeLegend();
    redrawNodes();
    if (display.nameToMatch != "") {
        matchNodes(display.nameToMatch);
    };
}
function setColorPalette(colorPalette) {
    display.colorPalette = colorPalette;
    computeColors();
    computeLegend();
    redrawNodes();
}
function changeCharge(c) {
    if (c >= 0) {
        display.c = c;
        updateChargeForce();
    }
    else {
        alert("Repulsion must be nonnegative.");
    }
}
function changer(r) {
    display.r = r;
    computeLegend();
    redrawNodes();
}
function changeDistance(l) {
    if (l >= 0) {
        display.l = l;
        updateLinkForce();
    }
    else {
        alert("Distance must be nonnegative.");
    }
}
function changeLinkStrength(linkStrength) {
    if (linkStrength >= 0) {
        display.linkStrength = linkStrength;
        updateLinkForce();
    }
    else {
        alert("Distance must be nonnegative.");
    }
}
function changeGravity(g) {
    if (g >= 0) {
        display.g = g;
        updateGravityForce();
    }
    else {
        alert("Gravity must be nonnegative.");
    }
}
function toggleFreezeNodes(isFrozen) {
    display.freezeNodeMovement = isFrozen;
    if (isFrozen) {
        simulation.stop();
        for (var i = 0; i < simulation.nodes().length; i++) {
            simulation.nodes()[i].fx = simulation.nodes()[i].x;
            simulation.nodes()[i].fy = simulation.nodes()[i].y;
        }
    }
    else {
        for (var i = 0; i < simulation.nodes().length; i++) {
            simulation.nodes()[i].fx = undefined;
            simulation.nodes()[i].fy = undefined;
        }
        simulation.alpha(1).restart();
    }

    var freezeNodesToggle = document.getElementById('freezeNodesToggle');
    freezeNodesToggle.checked = display.freezeNodeMovement ? true : false;
}
function toggleShowNodeNames(show) {
    display.showNodeNames = show;
    redisplayNodeNames();

    var showNodeNamesWidget = document.getElementById('showNodeNames');
    showNodeNamesWidget.checked = display.showNodeNames;
}
function toggleInvertBinary(setting, type) {
    var widgetId = getBinaryInversionAttributeForType(type);

    var widget = document.getElementById(widgetId);
    widget.checked = setting;
    display[widgetId] = setting;

    if (type == 'color') {
        computeColors();
    }
    else {
        computeSizes();
    }
    computeLegend();
    redrawNodes();
}
function getBinaryValue(value, type) {
    var attribute = getBinaryInversionAttributeForType(type);

    if (display[attribute]) {
        return value ? false : true;
    }
    else {
        return value;
    }
}
function getBinaryValues(type) {
    return [getBinaryValue(false, type), getBinaryValue(true, type)];
}
function redisplayNodeNames() {
    hideNodeText();

    if (display.showNodeNames) {
        showNodeNamesWhenStable();
    }
}
function showNodeNamesWhenStable() {
    window.setTimeout(function() {
        if (simulation.alpha() < .01) {
            for (var i in nodes) {
                showNodeText(nodes[i]);
            }
        }
        else {
            showNodeNamesWhenStable();
        }
    }, 100);
}
function updateChargeForce() {
    simulation.force("charge", d3.forceManyBody().strength(-display.c))
    simulation.alpha(1).restart();
}
function updateGravityForce() {
    simulation.force("x", d3.forceX(display.w / 2).strength(display.g));
    simulation.force("y", d3.forceY(display.h / 2).strength(display.g));
}
function updateLinkForce() {
    simulation.force(
        'link',
        d3.forceLink()
            .links(links)
            .distance(display.l)
            .strength(display.linkStrength)
    )
    simulation.alpha(1).restart();
}
function toggleLinkWidthScaling(checked) {
    if (checked) {
        scales.links.width.range([0.5, 4]);
    }
    else {
        scales.links.width.range([1, 1]);
    }
    redrawLinks();
}
function toggleLinkOpacity(checked) {
    if (checked) {
        scales.links.opacity.range([0.4, 0.9])
    }
    else {
        scales.links.opacity.range([1, 1]);
    }
    redrawLinks();
}
function matchNodes(x) {
    display.nameToMatch = x;
    if (x.length == 0){
        nodes.forEach(function(d) {
            unHighlightNode(d);
        });
    }
    else {
        nodes.forEach(function(d) {
            if (d.name.indexOf(display.nameToMatch) < 0) {
                unHighlightNode(d);
            }
            else {
                highlightNode(d);
            }
        })
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
//
//
// Legends
//
//
//
//
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
// draw legend(s) for size and color
// 
// If size and color are tied to the same attribute, make one legend
// Otherwise, keep em separate
//
// prefer integer boundaries in our legends... but only if the values that are
// getting passed in are integers... etc. (etc... etc...)
//
// steps through what we think of as standard human preference.
////////////////////////////////////////////////////////////////////////////////
function computeLegend() {
    vis.selectAll("#legend").remove();

    if (sizeData.type == "none" && colorData.type == "none") {
        return;
    };

    var colorLegend = makeColorLegend();
    var sizeLegend = makeSizeLegend();

    var R = sizeData['R'];

    // if we have a color legend, use it for the size menu (if it's there)
    var legendFillFunction;
    if (display.sizeBy == display.colorBy) {
        legendFillFunction = function(i) {
            return colorWheel(colorLegend['values'][i]);
        }
    }
    else {
        legendFillFunction = function(i) {
            return d3.rgb(100, 100, 100);
        }
    }

    if (display.sizeBy != "none") {
        sizeLegend['values'].forEach(function(d, i){
            vis.append("circle")
                .attr("id", "legend")
                .attr("r", display.r * d)
                .attr("cx", 5 + R)
                .attr("cy", 5 + R + 2.3 * R * i)
                .style("fill", legendFillFunction(i))
                .style("stroke", d3.rgb(255, 255, 255));
        });

        sizeLegend['text'].forEach(function(d, i){
            vis.append("text")
                .attr("id", "legend")
                .text(d)
                .attr("x", 10 + 2 * R)
                .attr("y", 5 + R + 2.3 * R * i + 4)
                .attr("fill", "black")
                .attr("font-size", 12);
        });
    }

    // if we've drawn the size legend and the color legend shows the same value,
    // return
    if (display.sizeBy == display.colorBy) {
        return;
    }

    if (colorData.type != "none") {
        // how far down should we "push" the color legend to accomodate for the
        // size legend
        pushDown = sizeLegend == undefined ? 0 : sizeLegend['values'].length;

        colorLegend['values'].forEach(function(d, i){
            vis.append("circle")
                .attr("id", "legend")
                .attr("r", 5)
                .attr("cx", 5 + Math.max(R, 5))
                .attr("cy", 5 + 5 + 2 * R + 2.3 * R * (pushDown - 1) + 5 + 2.3 * 5 * i)
                .style("fill", colorWheel(colorLegend['values'][i]))
                .style("stroke", d3.rgb(255, 255, 255));
        });
        colorLegend['text'].forEach(function(d, i) {
            vis.append("text")
                .attr("id", "legend")
                .text(d)
                .attr("x", 10 + Math.max(R, 5) + 5)
                .attr("y", 5 + 5 + 2 * R + 2.3 * R * (pushDown - 1) + 5 + 2.3 * 5 * i + 4)
                .attr("fill", "black")
                .attr("font-size", 12);
        });
    }
}
function makeColorLegend() {
    var legend = {};

    if (colorData.type == "none") {
        return
    }

    if (colorData.type == "categorical") {
        legend['values'] = scales.colors.categorical.domain();
        legend['text'] = d3.values(colorData['categoryNames']);
    }
    else if (colorData.type == "binary") {
        legend['values'] = getBinaryValues('color');
        legend['text'] = [false, true];
    }
    else if (colorData.type == "scalar" || colorData.type == "degree") {
        legend = getScalarLegend(colorData['rawValues']);
    }
    else if (colorData.type == "scalarCategorical") {
        legend['values'] = binnedLegend(colorData['rawValues'], 4);
        legend['text'] = legend['values'].slice(0);
    }

    return legend;
}
function makeSizeLegend() {
    var legend = {};
    sizeData['R'] = 0;
    
    if (sizeData.type == 'none') {
        return
    }

    if (sizeData.type == 'binary') {
        legend['values'] = getBinaryValues('size');
        legend['text'] = ["false", "true"];
    }
    else {
        // otherwise, the size type is either 'degree' or 'scalar'
        legend = getScalarLegend(sizeData['rawValues']);
    }

    var scaleFunction;
    if (display.sizeBy == "degree") {
        scaleFunction = function(x) { return Math.sqrt(x); };
    }
    else {
        scaleFunction = function (x) { return x; };
    }

    for (var i in legend['values']) {
        legend['values'][i] = scales.nodeSize(scaleFunction(legend['values'][i]));
    }

    sizeData['R'] = display.r * d3.max(legend['values']);

    return legend;
}
////////////////////////////////////////////////////////////////////////////////
// returns a legend for scalars, integer or non-integer
////////////////////////////////////////////////////////////////////////////////
function getScalarLegend(rawValues) {
    var values = [];

    // if it is integer scalars:
    if (allInts(rawValues)) {
        var max = d3.max(rawValues);
        var min = d3.min(rawValues);

        if (max - min <= 8) {
            values = d3.range(min, max + 1);
        }
        else {
            values = binnedLegend(rawValues, 4);
        }
    }
    // noninteger scalars
    else {
        values = binnedLegend(rawValues, 4);
    }

    var text = values.slice(0);

    return {
        'values' : values,
        'text' : text,
    }
}

// 'bins' a set of values so that we can display a finite legend.
function binnedLegend(vals, bins) {
    var legend = [];
    var min_val = d3.min(vals);
    var max_val = d3.max(vals);
    var step = (max_val - min_val) / bins;

    legend.push(rounddown(min_val, 10));

    for (var i = 1; i < bins; i++) {
        legend.push(round(min_val + i * step, 10));
    }

    legend.push(roundup(max_val, 10));

    return legend;
}

////////////////////////////////////////////////////////////////////////////////
//
//
//
//
// Drawing
//
//
//
//
////////////////////////////////////////////////////////////////////////////////
function drawLinks() {
    link = vis.selectAll(".webweb-link")
        .data(links);

    link.enter()
        .insert("line", ".webweb-node")
        .attr("class", "webweb-link")
        .attr("id", function(d, i) { 
            return "link_" + i; 
        })
        .style("stroke", d3.rgb(150, 150, 150))
        .style("stroke-width", function(d) {
            if (d.w == 0) {
                return 0;
            }
            else {
                return scales.links.width(d.w)
            }
        })
        .style("stroke-opacity", function(d) {
            return scales.links.opacity(d.w)
        });

    link.exit().remove();
}
function redrawLinks() {
    links.forEach(function(d, i) {
        d3.select("#link_" + i)
            .transition()
            .style("stroke-width", function(d){
                if (d.w == 0) {
                    return 0;
                }
                else {
                    return scales.links.width(d.w);
                }
            })
            .style("stroke-opacity", function(d) {
                return scales.links.opacity(d.w)
            });
    })
}
function drawNodes() {
    vis.selectAll(".webweb-node")
        .data(nodes)
        .enter()
        .insert("circle")
        .attr("class", "webweb-node")
        .attr("r", display.r)
        .attr("cx", function(d) {
            return d.x;
        })
        .attr("cy", function(d) {
            return d.y;
        })
        .attr("id", function(d) {
            return ("node_" + d.idx);
        })
        .style("fill", d3.rgb(255, 255, 255))
        .style("stroke", d3.rgb(255, 255, 255))
        .exit().remove();

    node = vis.selectAll(".webweb-node");

    node.on("mousedown", function(d) {
        if (! display.showNodeNames) {
            hideNodeText(d);
        }
    });

    node.on("mouseover", function (d) {
        highlightNode(d); 

        if (! display.showNodeNames) {
            showNodeText(d);
        }
    });

    node.on("mouseout", function(d) {
        unHighlightNode(d);
        if (! display.showNodeNames) {
            hideNodeText(d);
        }
    });

    node.call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended)
    );
}
function dragstarted(d) {
    display.storedShowNodeNames = display.showNodeNames;

    // hide node text while we are dragging
    hideNodeText();

    d3.event.sourceEvent.stopPropagation();
    if (!d3.event.active) {
        simulation.alphaTarget(0.3).restart();
    }
    d.fx = d.x;
    d.fy = d.y;
}
function dragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
}
function dragended(d) {
    if (!d3.event.active) {
        simulation.alphaTarget(0);
    }

    if (! display.freezeNodeMovement) {
        d.fx = null;
        d.fy = null;
    }

    // evaluate whether we should show highlight text now that we're done
    // dragging
    redisplayNodeNames();
}
function redrawNodes() {
    nodes.forEach(function(d, i) {
        d3.select("#node_" + d.idx)
            .attr("r", sizeData['scaledValues'][i] * display.r)
            .style("fill", d3.rgb(colorData['scaledValues'][i]));
    });
}

// tick attributes for links and nodes
function tick() {
    link = vis.selectAll(".webweb-link")
    link.attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

    node = vis.selectAll(".webweb-node")
    node.attr("cx", function(d) { return d.x; })
        .attr("cy", function(d) { return d.y; })
}
// Highlight a node by making it bigger and outlining it
function highlightNode(d) {
    d3.select("#node_" + d.idx)
        .transition().duration(100)
        .attr("r", sizeData['scaledValues'][d.idx] * display.r * 1.3)
        .style("stroke", d3.rgb(0,0,0));
}
// Returns a node's highlighted size and stroke to normal
function unHighlightNode(d) {
    if (display.nameToMatch == "" || d.name.indexOf(display.nameToMatch) < 0) {
        d3.select("#node_" + d.idx)
            .transition()
            .attr("r", sizeData['scaledValues'][d.idx] * display.r)
            .style("stroke", d3.rgb(255, 255, 255));
    }
}
// Highlight a node by showing its name next to it.
// If the node has no name, show its index.  
function showNodeText(d) {
    var nodeTextString = d.name == undefined ? d.idx : d.name;

    vis.append("text").text(nodeTextString)
        .attr("x", d.x + 1.5 * display.r)
        .attr("y", d.y - 1.5 * display.r)
        .attr("fill", "black")
        .attr("font-size", 12)
        .attr("id", "nodeText");
}
// guess!
// (Removes a node's text)
function hideNodeText() {
    vis.selectAll("#nodeText").remove();
}
////////////////////////////////////////////////////////////////////////////////
//
//
//
//
// MENUS
//
//
//
//
////////////////////////////////////////////////////////////////////////////////
function writeScaleLinkWidthToggle(parent) {
    var scaleLinkWidthToggle = parent.append("div")
        .attr("id", "scaleLinkWidthToggle")
        .text("Scale link width ");

    var isChecked = "unchecked";
    if (display.scaleLinkWidth) {
        isChecked = "checked";
        toggleLinkWidthScaling(true);
    }

    scaleLinkWidthToggle.append("input")
        .attr("id", "linkWidthCheck")
        .attr("type", "checkbox")
        .attr(isChecked, "")
        .attr("onchange", "toggleLinkWidthScaling(this.checked)");
}
function writeScaleLinkOpacityToggle(parent) {
    var scaleLinkOpacityToggle = parent.append("div")
        .attr("id", "scaleLinkOpacityToggle")
        .text("Scale link opacity ");

    var isChecked = "unchecked";
    if (display.scaleLinkOpacity) {
        isChecked = "checked";
        toggleLinkOpacity(true);
    }

    scaleLinkOpacityToggle.append("input")
        .attr("id", "linkOpacityCheck")
        .attr("type", "checkbox")
        .attr(isChecked, "")
        .attr("onchange", "toggleLinkOpacity(this.checked)");
}
function writeFreezeNodesToggle(parent) {
    var freezeNodesToggle = parent.append("div")
        .attr("id", "nodesMoveToggle")
        .text("Freeze nodes ");

    freezeNodesToggle.append("input")
        .attr("id", "freezeNodesToggle")
        .attr("type", "checkbox")
        .attr("onchange", "toggleFreezeNodes(this.checked)");

}
function writeSaveButtons(parent) {
    var saveButtons = parent.append("div")
        .attr("id", "saveButtons");

    saveButtons.append("input")
        .attr("id", "saveSVGButton")
        .attr("type", "button")
        .attr("value", "Save SVG")
        .on("click", writeSVGDownloadLink);

    saveButtons.append("input")
        .attr("id", "saveJSONButton")
        .attr("type", "button")
        .attr("value", "Save webweb")
        .on("click", writeWebwebDownloadLink);
}
function writeNetworkMenu(parent) {
    var networkMenu = parent.append("div")
        .attr("id", "networkMenu");

    var networkSelectMenu = networkMenu.append("span")
        .attr("id", "networkSelectMenu")
        .text("Display data from ");

    networkSelectMenu.append("select")
        .attr("id", "networkSelect")
        .attr("onchange", "updateNetwork(this.value)")

    writeNetworkLayerMenu(networkMenu);
}
function updateNetworkSelectMenu() {
    var networkSelect = d3.select("#networkSelect");

    networkSelect.selectAll("option").remove();

    networkSelect.selectAll("option")
        .data(networkNames)
        .enter()
        .append("option")
        .attr("value",function(d){return d;})
        .text(function(d){return d;});

    networkSelect = document.getElementById('networkSelect');
    networkSelect.value = display.networkName;
    updateNetworkLayerSelect();
}
function writeSizeMenu(parent) {
    var sizeMenu = parent.append("div")
        .attr("id", "sizeMenu")
        .text("Scale node sizes by ");

    sizeMenu.append("select")
        .attr("id", "sizeSelect")
        .attr("onchange", "changeSizes(this.value)");

    writeBinaryInversionWidget(sizeMenu, 'size');
}
function setNetworkLayerMenuVisibility() {
    var visible;
    if (wwdata.networks[display.networkName].layers.length == 1) {
        visible = false;
    }
    else {
        visible = true;
    }

    var visibility = visible ? 'inline' : 'none';
    var networkLayerMenu = d3.select('#networkLayerMenu')
        .style('display', visibility);
}
function writeNetworkLayerMenu(parent) {
    var networkLayerMenu = parent.append("span")
        .attr("id", "networkLayerMenu")
        .text(" layer: ");

    var layers = [];
    for (var i in wwdata.networks[display.networkName].layers) {
        layers.push(i);
    }

    networkLayerMenu.append("select")
        .attr("id", "networkLayerMenuSelect")
        .attr("onchange", "displayNetworkLayer(this.value)")
        .selectAll("option")
        .data(layers)
        .enter()
        .append("option")
        .attr("value", function(d) { return d; })
        .text(function(d) { return d; });

    updateNetworkLayerSelect();
}
function updateNetworkLayerSelect() {
    networkLayerMenuSelect = document.getElementById('networkLayerMenuSelect');
    networkLayerMenuSelect.value = display.networkLayer;
}
function displayNetworkLayer(layer) {
    display.networkLayer = layer;
    displayNetwork();
}
function updateSizeMenu() {
    var sizeSelect = d3.select("#sizeSelect");

    sizeSelect.selectAll("option").remove();

    var sizeMetadataStrings = [];
    for (var metadatum in sizeData.metadata) {
        sizeMetadataStrings.push(metadatum);
    }

    sizeSelect.selectAll("option")
        .data(sizeMetadataStrings)
        .enter()
        .append("option")
        .attr("value", function(d) { return d; })
        .text(function(d) { return d; });

    if (display.sizeBy == undefined || sizeData.metadata[display.sizeBy] == undefined) {
        display.sizeBy = "none";
    }

    sizeSelect = document.getElementById('sizeSelect');
    sizeSelect.value = display.sizeBy;
    changeSizes(display.sizeBy);
}
function writeColorMenu(parent) {
    var colorMenu = parent.append("div")
        .attr("id", "colorMenu");

    var colorByMenu = colorMenu.append("span")
        .attr('id', 'colorByMenu')
        .text("Color nodes by ");

    colorByMenu.append("select")
        .attr("id", "colorSelect")
        .attr("onchange","changeColors(this.value)");

    writeColorPaletteMenu(colorMenu);
    writeBinaryInversionWidget(colorMenu, 'color');
}
function writeBinaryInversionWidget(parent, type) {
    var widgetId = getBinaryInversionAttributeForType(type);
    var widgetContainerId = widgetId + "Widget";

    var binaryInversionWidget = parent.append("span")
        .attr("id", widgetContainerId)
        .text(" invert ");

    var checked = 'unchecked';
    if (display[widgetId]) {
        checked = 'checked';
    }

    binaryInversionWidget.append("input")
        .attr("id", widgetId)
        .attr("type", "checkbox")
        .attr(checked, "")
        .attr("onchange", "toggleInvertBinary(this.checked, '" + type + "')")
        .attr("size", 3);
}
function changeInvertBinaryWidgetVisibility(visible, type) {
    var visibility = visible ? 'inline' : 'none';
    var widgetId = getBinaryInversionAttributeForType(type) + "Widget";
    var colorBinaryInversionMenu = d3.select('#' + widgetId)
        .style('display', visibility);
}
function getBinaryInversionAttributeForType(type) {
    if (type == 'color') {
        return 'invertBinaryColors';
    }
    else if (type == 'size') {
        return 'invertBinarySizes';
    }
}
function updateColorMenu() {
    var colorSelect = d3.select("#colorSelect");

    colorSelect.selectAll("option").remove();

    var colorMetadataStrings = [];
    for (var metadatum in colorData.metadata) {
        colorMetadataStrings.push(metadatum);
    }

    colorSelect.selectAll("option")
        .data(colorMetadataStrings)
        .enter()
        .append("option")
        .attr("value",function(d){return d;})
        .text(function(d){return d;});

    if (display.colorBy == undefined || colorData.metadata[display.colorBy] == undefined) {
        display.colorBy = "none";
    }

    colorSelect = document.getElementById('colorSelect');
    colorSelect.value = display.colorBy;
    changeColors(display.colorBy);
}
function changeColorPaletteMenuVisibility(visible) {
    var visibility = visible ? 'inline' : 'none';
    var colorPaletteMenu = d3.select('#colorPaletteMenu')
        .style('display', visibility);
}
function writeColorPaletteMenu(parent) {
    var colorPaletteMenu = parent.append("span")
        .attr("id", "colorPaletteMenu")
        .text(" with color palette ");

    var colorNames = [];
    for (colorName in colorbrewer) {
        colorNames.push(colorName);
    }

    colorPaletteMenu.append("select")
        .attr("id", "colorPaletteMenuSelect")
        .attr("onchange", "setColorPalette(this.value)")
        .selectAll("option")
        .data(colorNames)
        .enter()
        .append("option")
        .attr("value", function(d) { return d; })
        .text(function(d) { return d; });

    colorPaletteMenuSelect = document.getElementById('colorPaletteMenuSelect');
    if (display.colorPalette !== undefined) {
        if (colorbrewer[display.colorPalette] !== undefined) {
            colorPaletteMenuSelect.value = display.colorPalette;
        }
    }
    else {
        colorPaletteMenuSelect.value = 'Set1';
    }
}
function writeChargeWidget(parent) {
    var chargeWidget = parent.append("div")
        .attr("id", "chargeWidget")
        .text("Node charge: ");

    chargeWidget.append("input")
        .attr("id", "chargeText")
        .attr("type", "text")
        .attr("onchange", "changeCharge(this.value)")
        .attr("value", display.c)
        .attr("size", 3);
}
function writeLinkLengthWidget(parent) {
    var linkLengthWidget = parent.append("div")
        .attr("id", "linkLengthWidget")
        .text("Link length: ");

    linkLengthWidget.append("input")
        .attr("id", "distanceText")
        .attr("type", "text")
        .attr("onchange", "changeDistance(this.value)")
        .attr("value", display.l)
        .attr("size", 3);
}
function writeLinkStrengthWidget(parent) {
    var linkStrengthWidget = parent.append("div")
        .attr("id", "linkStrengthWidget")
        .text("Link strength: ");

    linkStrengthWidget.append("input")
        .attr("id","linkStrengthText")
        .attr("type","text")
        .attr("onchange","changeLinkStrength(this.value)")
        .attr("value", display.linkStrength)
        .attr("size", 3);
}
function writeGravityWidget(parent) {
    var gravityWidget = parent.append("div")
        .attr("id", "gravityWidget")
        .text("Gravity: ");

    gravityWidget.append("input")
        .attr("id", "gravityText")
        .attr("type", "text")
        .attr("onchange", "changeGravity(this.value)")
        .attr("value", display.g)
        .attr("size", 3);
}
function writeRadiusWidget(parent) {
    var radiusWidget = parent.append("div")
        .attr("id", "radiusWidget")
        .text("Node r: ");

    radiusWidget.append("input")
        .attr("id","rText")
        .attr("type", "text")
        .attr("onchange","changer(this.value)")
        .attr("value", display.r)
        .attr("size", 3);
}
function writeMatchWidget(parent) {
    var matchWidget = parent.append("div")
        .attr("id", "matchWidget")
        .text("Highlight nodes named ");

    matchWidget.append("input")
        .attr("id","matchText")
        .attr("type", "text")
        .attr("onchange", "matchNodes(this.value)")
        .attr("size", 3);
}
function writeShowNodeNamesWidget(parent) {
    var showNodeNamesWidget = parent.append("div")
        .attr("id", "showNodeNamesWidget")
        .text("Show node names ");

    var checked = 'unchecked';
    if (display.showNodeNames) {
        checked = 'checked';
        toggleShowNodeNames(true);
    }

    showNodeNamesWidget.append("input")
        .attr("id","showNodeNames")
        .attr("type", "checkbox")
        .attr(checked, "")
        .attr("onchange", "toggleShowNodeNames(this.checked)")
        .attr("size", 3);
}
function writeMenus(container) {
    var menu = document.createElement('div')
    menu.setAttribute('id', 'webweb-menu')
    menu.style.display = display.hideMenu !== undefined ? 'none' : 'block';
    container.appendChild(menu);

    var menu = d3.select('#webweb-menu');

    var leftMenu = menu.append("div")
        .attr("id", "webweb-menu-left");

    var rightMenu = menu.append("div")
        .attr("id", "webweb-menu-right");

    writeNetworkMenu(leftMenu);
    writeSizeMenu(leftMenu);
    writeColorMenu(leftMenu);
    writeScaleLinkWidthToggle(leftMenu);
    writeScaleLinkOpacityToggle(leftMenu);
    writeFreezeNodesToggle(leftMenu);
    writeSaveButtons(leftMenu);

    writeChargeWidget(rightMenu);
    writeLinkLengthWidget(rightMenu);
    writeLinkStrengthWidget(rightMenu);
    writeGravityWidget(rightMenu);
    writeRadiusWidget(rightMenu);
    writeMatchWidget(rightMenu);
    writeShowNodeNamesWidget(rightMenu);

    updateNetworkSelectMenu();
}
////////////////////////////////////////////////////////////////////////////////
//
//
//
// Files
//
//
//
////////////////////////////////////////////////////////////////////////////////
// it's crazy, this function right here, it saves: it
function saveIt(fileName, fileType, content) {
    try {
        var isFileSaverSupported = !!new Blob();
        var blob = new Blob([content], {type: fileType});
        saveAs(blob, fileName);
    } catch (e) {
        alert("can't save :(");
    }
}
function writeSVGDownloadLink() {
    var html = d3.select("svg")
        .attr("title", display.networkName)
        .attr("version", 1.1)
        .attr("xmlns", "http://www.w3.org/2000/svg")
        .node().parentNode.innerHTML;

    saveIt(display.networkName, "image/svg+xml", html);
};
function writeWebwebDownloadLink() {
    var webwebJSON = wwdata;
    webwebJSON.display = display;

    // save node coordinates
    var nodeCoordinates = [];
    node.attr("cx", function(d) {
        nodeCoordinates.push({'x' : d.x, 'y' : d.y });
        return d.x;
    })

    webwebJSON.display.nodeCoordinates = nodeCoordinates;

    saveIt('webweb.json', 'json', JSON.stringify(webwebJSON));
}

////////////////////////////////////////////////////////////////////////////////
//
//
//
// Helpers
//
//
//
////////////////////////////////////////////////////////////////////////////////
function isInt(n){
    return Number(n) === n && n % 1 === 0;
}
function isFloat(n){
    return Number(n) === n && n % 1 !== 0;
}
function round(x, dec) {
    return (Math.round(x * dec) / dec);
}
function roundup(x, dec) {
    return (Math.ceil(x * dec) / dec);
}
function rounddown(x, dec) {
    return (Math.floor(x * dec) / dec);
}
function allInts(vals) {
    for (i in vals) {
        if (!isInt(vals[i])) {
            return false;
        }
    }

    return true;
}
function getObjetPropertyCount(_object) {
    var count = 0;
    for(var property in _object) {
        if (_object.hasOwnProperty(property)) {
            count += 1;
        }
    }
    return count;
}
////////////////////////////////////////////////////////////////////////////////
//
//
//
// Event Listeners
//
//
//
////////////////////////////////////////////////////////////////////////////////
// binds the up/down arrow keys to change networks
function changeNetworkListener(event) {
    var currentNetworkIndex = networkNames.indexOf(display.networkName);
    var changeToNetworkIndex;

    if (event.keyCode == 38) {
        // up arrow
        changeToNetworkIndex = currentNetworkIndex - 1;
    }
    else if (event.keyCode == 40) {
        // down arrow
        changeToNetworkIndex = currentNetworkIndex + 1;
    }

    if (changeToNetworkIndex !== undefined) {
        if (0 <= changeToNetworkIndex && changeToNetworkIndex < networkNames.length) {
            var changeToNetworkName = networkNames[changeToNetworkIndex];
            updateNetwork(changeToNetworkName);
        }
    }
}
// binds the left/right arrow keys to change layers
function changeNetworkLayerListener(event) {
    var currentLayer = display.networkLayer;
    var changeToLayer;

    if (event.keyCode == 39) {
        // right arrow
        changeToLayer = currentLayer + 1;
    }
    else if (event.keyCode == 37) {
        // left arrow
        changeToLayer = currentLayer - 1;
    }

    if (changeToLayer !== undefined) {
        if (0 <= changeToLayer && changeToLayer < wwdata.networks[display.networkName].layers.length) {
            displayNetworkLayer(changeToLayer);
            updateNetworkLayerSelect();
        }
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
//
// Imperial Death March
//
//
//
////////////////////////////////////////////////////////////////////////////////
window.onload = function() {
    initializeWebweb();
};
window.addEventListener("keydown", function (event) {
    listeners = {
        37 : changeNetworkLayerListener,
        38 : changeNetworkListener,
        39 : changeNetworkLayerListener,
        40 : changeNetworkListener,
    };

    if (event.keyCode in listeners) {
        listeners[event.keyCode](event);
    }
});
