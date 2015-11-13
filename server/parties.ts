import {Parties} from 'collections/parties';

Meteor.publish('parties', function() {
    return Parties.find({
        $or: [
            { public: true },
            {
                $and: [
                  { owner: this.userId },
                  { owner: { $exists: true } }
                ]
            }
        ]
    });
});
