% make a matrix of weighted edges
% edge weights are the third element in the edge
edge_list = [...
    1, 2, .1;... 
    2, 3, .5;... 
    3, 4, 1;... 
    4, 5, 2;...
];

% call webweb
webweb(edge_list);

% [OPTIONAL] set webweb's display default: show weighted edges.

% DBL TODO