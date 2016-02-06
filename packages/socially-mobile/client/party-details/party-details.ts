import {Page, NavController, NavParams} from 'ionic/ionic';

import {RequireUser, InjectUser} from 'meteor-accounts';

import {DisplayName, PartyDetails as PartyDetailsBase} from 'socially-client';

@Page({
    pipes: [DisplayName],
    templateUrl: '/packages/socially-mobile/client/party-details/party-details.html',
})
@RequireUser()
@InjectUser()
export class PartyDetails extends PartyDetailsBase {
    constructor(params: NavParams) {
        let partyId = params.get('partyId');
        super(partyId);
    }
}
