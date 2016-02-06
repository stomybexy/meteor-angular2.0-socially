import {loadParties} from './load-parties';
import 'pubs/parties';
import './users';
import 'collections/methods';

Meteor.startup(loadParties);
