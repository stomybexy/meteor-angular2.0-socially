import {Component, View} from 'angular2/core';

import {RouteParams} from 'angular2/router';

@Component({
    selector: 'party-details'
})
@View({
    templateUrl: '/client/party-details/party-details.html'
})
export class PartyDetails {
    constructor(params: RouteParams) {
        var partyId = params.get('partyId');
    }
}
