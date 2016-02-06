import {Parties} from 'collections/parties';

function buildQuery(partyId: string, location: string): Object {
    var isAvailable = {
        $or: [
            { public: true },
            {
                $and: [
                    { owner: this.userId },
                    { owner: { $exists: true } }
                ],
            },
            {
              $and: [
                { invited: this.userId },
                { invited: { $exists: true } }
              ]
            }
        ]
    };

    if (partyId) {
        return { $and: [{ _id: partyId }, isAvailable] };
    }

    let searchRegEx = { '$regex': '.*' + (location || '') + '.*', '$options': 'i' };

    return { $and: [{ 'location.name': searchRegEx }, isAvailable] };
}

SmartPub.smartPublish('parties', function(options, location) {
    if (SmartPub.isPublish(this)) {
        var self = this;
        Counts.publish(this, 'numberOfParties',
            Parties.find(buildQuery.call(this, null, location)), { noReady: true });

    }
    
   
    return {
        selector: buildQuery.call(this, null, location),
        sort: options.sort,
        skip: options.skip,
        limit: options.limit,
        coll: Parties,
        single: false
    };
});



// Meteor.publish('parties', function(options: Object, location: string) {
//     Counts.publish(this, 'numberOfParties',
//         Parties.find(buildQuery.call(this, null, location)), { noReady: true });
//     return Parties.find(buildQuery.call(this, null, location), options);
// });

SmartPub.smartPublishComposite('party', {
    
    find: function(partyId){
        console.log('Smart publish composite')
        return {
            selector: buildQuery.call(this, partyId),
            coll: Parties,
            single: true
        };
    },
    children: [
        {
            find: function(party, partyId){
                if (!party)
                    throw new Meteor.Error('404', 'No such party!');
                return {
                    selector: {
                     _id: {
                          $nin: party.invited || [],
                          $ne: this.userId || Meteor.userId()
                         }
                     },
                     coll: Meteor.users
                }
            },
            name: 'uninvited'
        }
    ]
    
});

// function(partyId) {
//     return {
//         selector: buildQuery.call(this, partyId),
//         coll: Parties,
//         single: true
//     };

// });

// Meteor.publish('party', function(partyId: string) {
//     return Parties.find(buildQuery.call(this, partyId));
// });
