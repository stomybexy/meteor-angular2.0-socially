import {Parties} from 'collections/parties';

Meteor.publish('uninvited', function(partyId) {
    let party = Parties.findOne(partyId);

    return Meteor.users.find({
        _id: {
            $nin: party.invited || [],
            $ne: this.userId
        }
    });
});
