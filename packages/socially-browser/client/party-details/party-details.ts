import {Component, View} from 'angular2/core';

import {RouteParams} from 'angular2/router';

import {RouterLink} from 'angular2/router';

import {RequireUser, InjectUser} from 'meteor-accounts';

import {ANGULAR2_GOOGLE_MAPS_DIRECTIVES, MapMouseEvent} from 'ng2-google-maps/core';

import {DisplayName, PartyDetails as PartyDetailsBase} from 'socially-client';

@Component({
    selector: 'party-details'
})
@View({
    pipes: [DisplayName],
    templateUrl: '/packages/socially-browser/client/party-details/party-details.html',
    directives: [RouterLink, ANGULAR2_GOOGLE_MAPS_DIRECTIVES]
})
@RequireUser()
@InjectUser()
export class PartyDetails extends PartyDetailsBase {

    constructor(params: RouteParams) {
        var partyId = params.get('partyId');
        super(partyId);
    }

    mapClicked($event: MapMouseEvent) {
        this.party.location.lat = $event.coords.lat;
        this.party.location.lng = $event.coords.lng;
    }
}
