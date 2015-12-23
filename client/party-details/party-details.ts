import {Component, View} from 'angular2/core';

import {RouteParams} from 'angular2/router';

import {Parties} from 'collections/parties';

import {RouterLink} from 'angular2/router';

import {RequireUser} from 'meteor-accounts';

import {MeteorComponent} from 'angular2-meteor';

import {DisplayName} from 'client/lib/pipes';

@Component({
    selector: 'party-details'
})
@View({
    pipes: [DisplayName],
    templateUrl: '/client/party-details/party-details.html',
    directives: [RouterLink]
})
@RequireUser()
export class PartyDetails extends MeteorComponent {
    party: Party;
    users: Mongo.Cursor<Object>;

    constructor(params: RouteParams) {
        super();
        var partyId = params.get('partyId');
        this.subscribe('party', partyId, () => {
            this.party = Parties.findOne(partyId);
        }, true);

        this.subscribe('uninvited', partyId, () => {
          this.users = Meteor.users.find({_id: {$ne: Meteor.userId()}});
        }, true);
    }

    saveParty(party) {
      if (Meteor.userId()) {
        Parties.update(party._id, {
          $set: {
            name: party.name,
            description: party.description,
            location: party.location
          }
        });
      } else {
        alert('Please log in to change this party');
      }
    }
}
