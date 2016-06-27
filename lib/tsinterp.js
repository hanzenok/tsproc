var moment = require('moment');
var smooth = require('./smooth');

/**
 * A class that is used to interpolate the missing
 * documents in the timeseries. Two public methods:
 * a constructor 'tsinterp' that learns the timeseries values
 * and a method 'smooth' that takes as parameter a date
 * (string with ISO format) and returns a document with
 * interpolated values.
 *
 * Based on the <a href='https://github.com/osuushi/Smooth.js/'>Smooth.js</a>
 * module.
 *
 * @module tsproc
 * @class tsinterp
 * @constructor
 */

/**
 * @property INTERP_METHODS
 * @type array
 * Description of interpolation methods.
 * Methods comparation could be found <a href="http://osuushi.github.io/plotdemo016.html">here</a>.
 */
var INTERP_METHODS = ['linear', 'cubic', 'lanczos', 'nearest'];

 /**
 * A public constructor that initiates the class and then
 * learns the datapoints.
 *
 * @method tsinterp
 * @for tsinterp
 * @param {array} timeseries A timeseries to learn. An array of JSONs
 * @param {json} description A description of fields and timestamps (with their format) of the each document of timeseries
 * @param {function} callback An error callback
 * @example
 *     var tsinterp = require('./tsinterp');
 *
 *     var ts = [{ year: '1919-01-01T00:00:00.000Z', flows_funder: 1 }, { year: '1921-01-01T00:00:00.000Z', flows_funder: 3 }];
 *     var config = {fields: [{name: 'flows_funder'}], type: 0, timestamp_field: 'year'};
 *
 *     var smoother = new tsinterp(ts, config, null);
 */
function tsinterp(timeseries, description, callback){

	//checks
	if (timeseries == undefined || description == undefined){

		if (callback)
			callback(new Error('timeseries and it\'s description should be defined'));

		return;
	}

	if (timeseries.length < 2){

		if (callback)
			callback(new Error('timeseries should have multiple documents'));

		return;
	}

	if (description.timestamp_field == undefined || description.fields == undefined){
		callback(new Error('Description is invalid'));

		return;
	}

	for (var document in timeseries){

		if (!moment.utc(document[description.timestamp_field], null, true).isValid()){

			if (callback)
				callback(new Error('Timestamps are not valid'));

			return;
		}
	}

	//check type
	if (description.type == undefined || typeof description.type != 'number' || description.type < 0 || description.type > 3)
		description.type = 0;

	//private members
	this._timeseries = timeseries;
	this._nb_ts = timeseries.length;
	this._timestamp_field = description.timestamp_field;
	this._fields = description.fields;
	this._clip_type = description.clip_type;
	this._interp_type = INTERP_METHODS[description.type];

	//extract an array of fields and dates
	//from timeseries
	this._values_array = extractValues.call(this);
	this._dates_array = extractDates.call(this);

	//learn the datapoints
	this._learned = false; //wheather the datapoints were learned
	learn.call(this, callback);

	if (callback)
		callback(null);
}

 /**
 * A main public method that takes in the date
 * and determines based on the previously learnt values
 * the interpolated document with given date.
 *
 * @method smooth
 * @for tsinterp
 * @param {string} date A date to interpolate
 * @param {function} callback A callback function
 * @example
 *     var tsinterp = require('./tsinterp');
 *
 *     var ts = [{ year: '1919-01-01T00:00:00.000Z', flows_funder: 1 }, { year: '1921-01-01T00:00:00.000Z', flows_funder: 3 }];
 *     var config = {fields: [{name: 'flows_funder'}], type: 0, timestamp_field: 'year'}; // 0 - linear interpolation
 *     var smoother = new tsinterp(ts, config, null);
 *
 *     //inside the range
 *     smoother.smooth('1920-01-01T00:00:00.000Z', function(err, doc){
 *
 *     	if (doc) console.log(doc); //{ year: '1920-01-01T00:00:00.000Z', flows_funder: 1.998632 }
 *     });
 *
 *     //out of the range
 *     smoother.smooth('1923-01-01T00:00:00.000Z', function(err, doc){
 *
 *     	if (doc) console.log(doc); //{ year: '1923-01-01T00:00:00.000Z', flows_funder: 0 }
 *     });
 */
tsinterp.prototype.smooth = function(date, callback){

	//checks
	if (!date){

		if (callback)
			callback(new Error('Date is unset'), null);

		return;
	}

	if (!moment.utc(date, null, true).isValid()){

		if (callback)
			callback(new Error('Date is not valid'), null);

		return;
	}

	if (this._learned == false){

		if (callback)
			callback(new Error('Datapoints are not learned yet'), null);

		return;
	}

	//date to moment.js date
	var moment_date = moment.utc(date, null, true);

	//check the exterieur dates
	var min_date = this._dates_array[0];
	if (min_date.diff(moment_date) > 0){

		if (callback)
			callback(null, createDoc.call(this, date, this._smooth(-1)));

		return;
	}
	var max_date = this._dates_array[this._nb_ts - 1];
	if (max_date.diff(moment_date) < 0){

		if (callback)
			callback(null, createDoc.call(this, date, this._smooth(this._nb_ts)));

		return;
	}

	//determine where to insert the date
	var i=0,diff;
	do{
		diff = this._dates_array[i].diff(moment_date);
		i++;
	}while (diff < 0);


	//date is in the timeseries
	if (diff == 0){

		if (callback)
			callback(null, createDoc.call(this, date, this._smooth(i-1)));

		return;
	}

	//calculate the index to interpolate
	var delta = this._dates_array[i-1].diff(this._dates_array[i-2]);
	var index = i - 2 + (delta - diff)/delta;

	if (callback)
		callback(null, createDoc.call(this, date, this._smooth(index)));
}

 /**
 * A private method used to generate a json document.
 *
 * @method createDoc
 * @for tsinterp
 * @param {string} time An ISO string representing the date
 * @param {array} values An array of values of document fields
 * @return {json} Generated document
 */
function createDoc(time, values){

	var doc = {};

	//timestamp field
	doc[this._timestamp_field] = time;

	//other fields
	this._fields.forEach(function(field, index, array){

		doc[field.name] = values[index];
	});

	return doc;
}

 /**
 * A private method used to exract an array of dates (moment.js dates) of all
 * the documents.</br>
 * <i>[{date: 1911, a: 2, b: 4},{date: 1912, a: 3, b: 1}] ==> [1911, 1912]].</i>
 *
 * @method extractDates
 * @for tsinterp
 * @return {array} An array of moment.js dates
 */
function extractDates(){

	dates_array = new Array(this._nb_ts);

	//extracting
	for (var i=0; i<this._nb_ts; i++){

		dates_array[i] = moment.utc(this._timeseries[i][this._timestamp_field], null, true);
	}

	return dates_array;
}

 /**
 * A private method used to exract an array of values of all
 * the documents.</br>
 * <i>[{date: 1911, a: 2, b: 4},{date: 1912, a: 3, b: 1}] ==> [[2, 4], [3, 1]].</i>
 *
 * @method extractValues
 * @for tsinterp
 * @return {array} An array of values
 */
function extractValues(){

	values_array = new Array(this._nb_ts);

	//number of fields
	var nb_fields = this._fields.length;

	//extracting
	var tmp;
	for (var i=0; i<this._nb_ts; i++){

		tmp = [];
		for (var j=0; j<nb_fields; j++){

			tmp.push(this._timeseries[i][this._fields[j].name]);
		}

		values_array[i] = tmp;
	}

	return values_array;
}

 /**
 * A private method that learns the values
 * of each document of the timeseries.
 *
 * @method learn
 * @param {function} callback An error callback
 * @for tsinterp
 */
function learn(callback){

	this._learned = true;

	try{
		this._smooth = new smooth.Smooth(this._values_array, {method: this._interp_type, clip: 'zero', lanczosFilterSize: 4});
	}
	catch(err){

		this._learned = false;

		if (callback)
			callback(err);
	}
}

module.exports = tsinterp;
