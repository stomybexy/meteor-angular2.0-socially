import {Parties} from 'collections/parties';

Meteor.publish('parties', function() {
    return Parties.find();
});
