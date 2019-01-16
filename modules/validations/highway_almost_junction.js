import {
    geoExtent,
    geoLineIntersection,
    geoMetersToLat,
    geoMetersToLon,
    geoSphericalDistance,
    geoVecInterp,
} from '../geo';
import {
    utilDisplayLabel
} from '../util';
import { actionChangeTags } from '../actions';
import { t } from '../util/locale';
import {
    ValidationIssueType,
    ValidationIssueSeverity,
    validationIssue,
    validationIssueFix
} from './validation_issue';


/**
 * Look for roads that can be connected to other roads with a short extension
 */
export function validationHighwayAlmostJunction(context) {

    function isHighway(entity) {
        return entity.type === 'way' && entity.tags.highway && entity.tags.highway !== 'no';
    }
    function isNoexit(node) {
        return node.tags.noexit && node.tags.noexit === 'yes';
    }

    function findConnectableEndNodesByExtension(way, graph, tree) {
        var results = [],
            nidFirst = way.nodes[0],
            nidLast = way.nodes[way.nodes.length - 1],
            nodeFirst = graph.entity(nidFirst),
            nodeLast = graph.entity(nidLast);

        if (nidFirst === nidLast) return results;
        if (!isNoexit(nodeFirst) && graph.parentWays(nodeFirst).length === 1) {
            var widNearFirst = canConnectByExtend(way, 0, graph, tree);
            if (widNearFirst !== null) {
              results.push({
                node: nodeFirst,
                wid: widNearFirst,
              });
            }
        }
        if (!isNoexit(nodeLast) && graph.parentWays(nodeLast).length === 1) {
            var widNearLast = canConnectByExtend(way, way.nodes.length - 1, graph, tree);
            if (widNearLast !== null) {
              results.push({
                node: nodeLast,
                wid: widNearLast,
              });
            }
        }
        return results;
    }

    function canConnectByExtend(way, endNodeIdx, graph, tree) {
        var EXTEND_TH_METERS = 5,
            tipNid = way.nodes[endNodeIdx],  // the 'tip' node for extension point
            midNid = endNodeIdx === 0 ? way.nodes[1] : way.nodes[way.nodes.length - 2],  // the other node of the edge
            tipNode = graph.entity(tipNid),
            midNode = graph.entity(midNid),
            lon = tipNode.loc[0],
            lat = tipNode.loc[1],
            lon_range = geoMetersToLon(EXTEND_TH_METERS, lat) / 2,
            lat_range = geoMetersToLat(EXTEND_TH_METERS) / 2,
            queryExtent = geoExtent([
                [lon - lon_range, lat - lat_range],
                [lon + lon_range, lat + lat_range]
            ]);

        // first, extend the edge of [midNode -> tipNode] by EXTEND_TH_METERS and find the "extended tip" location
        var edgeLen = geoSphericalDistance(midNode.loc, tipNode.loc),
            t = EXTEND_TH_METERS / edgeLen + 1.0,
            extTipLoc = geoVecInterp(midNode.loc, tipNode.loc, t);

        // then, check if the extension part [tipNode.loc -> extTipLoc] intersects any other ways
        var intersected = tree.intersects(queryExtent, graph);
        for (var i = 0; i < intersected.length; i++) {
            if (!isHighway(intersected[i]) || intersected[i].id === way.id) continue;
            var way2 = intersected[i];
            for (var j = 0; j < way2.nodes.length - 1; j++) {
                var nA = graph.entity(way2.nodes[j]),
                    nB = graph.entity(way2.nodes[j + 1]);
                if (geoLineIntersection([tipNode.loc, extTipLoc], [nA.loc, nB.loc])) {
                    return way2.id;
                }
            }
        }
        return null;
    }

    var validation = function(changes, graph, tree) {
        var edited = changes.created.concat(changes.modified),
            issues = [];
        for (var i = 0; i < edited.length; i++) {
            if (!isHighway(edited[i])) continue;
            var extendableNodes = findConnectableEndNodesByExtension(edited[i], graph, tree);
            for (var j = 0; j < extendableNodes.length; j++) {
                var endHighway = edited[i];
                var node = extendableNodes[j].node;
                var edgeHighway = graph.entity(extendableNodes[j].wid);

                var fixes = [];
                if (Object.keys(node.tags).length === 0) {
                    // node has no tags, suggest noexit fix
                    fixes.push(new validationIssueFix({
                        title: t('issues.fix.tag_as_disconnected.title'),
                        action: function() {
                            var nodeID = this.issue.entities[1].id;
                            context.perform(
                                actionChangeTags(nodeID, {noexit: 'yes'}),
                                t('issues.fix.tag_as_disconnected.undo_redo')
                            );
                        }
                    }));
                }
                issues.push(new validationIssue({
                    type: ValidationIssueType.highway_almost_junction,
                    severity: ValidationIssueSeverity.warning,
                    message: t('issues.highway_almost_junction.message', {
                        highway: utilDisplayLabel(endHighway, context),
                        highway2: utilDisplayLabel(edgeHighway, context)
                    }),
                    tooltip: t('issues.highway_almost_junction.tooltip'),
                    entities: [endHighway, node, edgeHighway],
                    coordinates: extendableNodes[j].node.loc,
                    fixes: fixes
                }));
            }
        }

        return issues;
    };


    return validation;
}
