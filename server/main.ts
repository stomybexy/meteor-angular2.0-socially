import {loadParties} from './load-parties';
import './parties';

Meteor.startup(loadParties);
