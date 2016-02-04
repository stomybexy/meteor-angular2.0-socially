
import {Type} from 'angular2/core';

import {Page, NavController} from 'ionic/ionic';

import {InjectUser} from 'meteor-accounts';

import {PartiesForm} from './../party-form/party-form';

import {PartyDetails} from './../party-details/party-details';

import {RsvpPipe, PartiesList as PartiesListBase} from 'socially-client';

@Page({
    pipes: [RsvpPipe],
    templateUrl: '/packages/socially-mobile/client/parties-list/parties-list.html',
})
@InjectUser()
export class PartiesList extends PartiesListBase {
    partyDetails: Type;

    constructor(private nav: NavController) {
        super();
        this.partyDetails = PartyDetails;
    }

    addParty() {
        this.nav.push(PartiesForm);
    }
}
