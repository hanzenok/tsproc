var moment = require('moment');
var underscore = require('underscore');
var tsinterp = require('./tsinterp');
var tsreductions = require('./tsreductions');

/**
 * @module tsproc
 */

/**
 * @property ISO_FORMAT
 * @type string
 * @description A constant that holds
 * the format of ISO date.
 */
var ISO_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSSSZ'; //standart ISO format

/**
 * @property UNIX_FORMAT
 * @type string
 * @description A constant that describes
 * when the timestamp format is a unix
 * timestamp.
 */
var UNIX_FORMAT = 'UNIX';

/**
 * @property TIMESTAMP_FIELD
 * @type string
 * @description A constant that holds the name 
 * of the timestamp field that would be generated 
 * after the merge (cf merge() and process() functions).
 */
var TIMESTAMP_FIELD = 'time';

/**
 * @property InterpEnum
 * @type json
 * @description A description of interpolation
 * methods offered by the <b>tsinterp</b> class.
 */
var InterpEnum = {'linear': 0, 'cubic': 1, 'lanczos': 2, 'nearest': 3};

/**
 * @property ReduceEnum
 * @type json
 * @description A description of timeseries size
 * reduction methods offered by the <b>tsreductions</b> class.
 */
var ReduceEnum = {'skip': 0, 'sum': 1, 'avg': 2, 'max': 3, 'min': 4};

/**
 * @property QuantTSEnum
 * @type json
 * @description A description of types
 * of the timestamp quantification.
 */
var QuantTSEnum = {none: 'none', day: 'day', month: 'month', year: 'year'};

/**
 * @property ReduceFunc
 * @type array
 * @description An array of timeseries size
 * reduction functions.
 */
var ReduceFunc = tsreductions;

/**
 * TimeSeries Processor (tsproc) is a module that 
 * takes in one or multiple timeseries whis
 * their configuration (cf <a href="#methods_tsproc">constructor</a>) and offers
 * different public methods to process and explore
 * the timeseries.<br/>
 * The main public methods are:
 * - <a href="#methods_cut">cut()</a>: cutting the range of documents
 * - <a href="#methods_interpolate">interpolate()</a>: interpolation of missing documents
 * - <a href="#methods_intersect">intersect()</a>: leaving the intersected documents between the timeseries
 * - <a href="#methods_merge">merge()</a>: merging multiple timeseries into one
 * - <a href="#methods_renameField">renameField()</a>: renaming a field in all documents
 * - <a href="#methods_checkSimilarity">checkSimilarity()</a>: similarity check between timeseries
 * - <a href="#methods_toISO">toISO()</a>: passing the timestamp to the ISO format
 * - <a href="#methods_undersample">undersample()</a>: timeseries size reduction
 * - <a href="#methods_quantize">quantize()</a>: values and timestamps quantification
 * - <a href="#methods_process">process()</a>: a combination of all the previous methods
 *
 * All of the sited methods are changing the state of the timeseries 
 * (which is irreversible) and all of them are using a callback function
 * in order to pass erros and return modified timeseries.
 *
 * @class tsproc
 * @constructor
 * @param {array} timeseries An array of timeseries. Each one should be sorted
 * @param {json} config A description of each timeseries (cf example)
 * @param {function} err_callback Error callback
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {
 *     		"transform":{"type":"interp","interp_type":"linear"},
 *
 *     		"reduction":{"type":"skip","size":1,"target_field":""},
 *
 *     		"date_borders":{"from":{"date":""},"to":{"date":""}},
 *
 *     		"correlation":{"count_negative":false,"max_coef":true},
 *
 *     		"timeseries":
 * 	    		[
 * 					{
 * 					"fields":
 * 						[
 * 							{"name":"a"}
 * 						],
 *
 * 					"timestamp":{"name":"year","format":"YYYY"}
 * 					},
 *
 * 					{
 * 					"fields":
 * 						[
 * 							{"name":"b"}
 * 						],	
 *
 * 					"timestamp":{"name":"year","format":"YYYY"}
 * 					}
 * 				]
 * 		};
 * 
 *     var ts = [
 *     		[{a: 18.11, year:'2011'}, {a: 21.07, year:'2012'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}]
 *          ]
 *     
 *     var tsp = new tsproc(ts, config, null);
 */
function tsproc(timeseries, config, err_callback){

	if (timeseries && config){

		//save config
		if (config){

			//time series
			this._config = config.timeseries;

			//transformation
			this._transform_type = (config.transform && config.transform.type) ? config.transform.type : 'interp';
			if (this._transform_type === 'interp')
				this._interp_type = (config.transform.interp_type) ? config.transform.interp_type : 'linear';
			else
				this._interp_type = null;

			//reduction
			this._reduction_type = (config.reduction && config.reduction.type) ? config.reduction.type : 'skip';
			this._reduction_size = (config.reduction && config.reduction.size) ? config.reduction.size : 1;
			this._reduction_target_field = (config.reduction && config.reduction.target_field) ? config.reduction.target_field : null;

			//date borders
			this._from = (config.date_borders && config.date_borders.from && config.date_borders.from.date) ? config.date_borders.from.date : null;
			this._to = (config.date_borders && config.date_borders.to && config.date_borders.to.date) ? config.date_borders.to.date : null;

			//correlation detection
			if (config.correlation){

				this._correlation_activated = true;
				this._count_negative = (typeof config.correlation.count_negative !== 'undefined') ? config.correlation.count_negative : false;
				this._max_coef = (typeof config.correlation.max_coef !== 'undefined') ? config.correlation.max_coef : true;
			}
			else{

				this._correlation_activated = false;
			}
		}

		//save timeseries
		if (timeseries[0][0]){
			this._timeseries = timeseries;
		}
		else{
			this._timeseries = new Array(1);
			this._timeseries[0] = timeseries;
		}
	}
	else{

		if (err_callback)
			err_callback(new Error('Timeseries or config are not set'));

		return;
	}
}

/**
 * A main public method that processes a set of timeseries. It returns (via <code>callback</code>) a single timeseries with timestamp 'time' with
 * ISO format.
 *
 * The processing takes the next steps:
 * - if the borders (min and max dates) are specified in the config file, the timeseries would be cut
 * - all the dates would be transformed to the ISO string
 * - if there are multiple timeseries, and they are not homogeneous, all the timeseries would be interpolated or intersected (cf <a href="#methods_intersect">intersect()</a> function)
 * - if the are multiple timeseries (and after the previous step they are all homogeneous), they would be fused into one timeseries document by document
 * - the output timeseries's timestamp field would be called 'time' and it would be an ISO string
 * - finally, if the skip value is defined, the timeseries would be undersampled to decrease it's size 
 * 
 * @method process
 * @param {function} callback A callback function
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 18.11, year:'2011'}, {a: 21.07, year:'2012'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     tsp.process(function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	{time:'2011-01-01T00:00:00.000Z', a: 18.11, b: 0},
 *     		//	{time:'2012-01-01T00:00:00.000Z', a: 21.07, b: 26.42},
 *     		//	{time:'2013-01-01T00:00:00.000Z', a: 0, b: 24.11} 
 *     		//]
 *     });
 */
tsproc.prototype.process = function(callback){

	var err_callback = function(err){

		if (err) {
			if (callback)
				callback(err);}
	}

	//check the validity of dates
	if (this.isValid()){

		//preprocess
		this.cut([this._from, this._to], err_callback);
		this.toISO(err_callback);

		//transform timeseries if they are not homogeneous
		var is_homog = this.isHomogeneous();
		if (!is_homog){

			//interpolation
			if (this._transform_type === 'interp'){
				this.interpolate(InterpEnum[this._interp_type], err_callback);
			}

			//intersection
			if (this._transform_type === 'inters'){
				this.intersect(err_callback);
			}
		}

		//merge all TS if needed
		//if there is only one TS, rename it's timestamp
		if (this.getNbTS() === 1){

			this.renameField(0, this.getTimestampField(0), TIMESTAMP_FIELD, err_callback);
		}
		else{
			this.merge(err_callback);
		}

		//reduction
		this.undersample(ReduceEnum[this._reduction_type], this._reduction_size, this._reduction_target_field, err_callback);

		//quantification
		this.quantize(err_callback);

		//callback the data
		if (callback)
			callback(null, this.getTS());
	}
	else{

		if (callback)
			callback(new Error('Dates are not valid'));
	}
}

/**
 * Public method that returns (directly or via <code>callback</code>) 
 * a single timeseries if there is only one (if
 * it is merged for example),
 * or an array of timeseries if trere are many.
 *
 * @method getTS
 * @param  {function} callback Callback function
 * @return {array} One or an array of timeseries
 */
tsproc.prototype.getTS = function(callback){

	if (callback){

		callback(null, this.getTS());
	}
	else{
		
		if (this.getNbTS() === 1)
			return this._timeseries[0];
		else
			return this._timeseries;
	}
}

/**
 * Public method that returns (directly or via <code>callback</code>) 
 * a timeseries config json.
 * Note: for now, it returns only the timeseries config
 * of the tsproc (not the options like transform type,
 * data borders, correlaiton, etc).
 *
 * @method getConfig
 * @param  {function} callback Callback function
 * @return {json} Timeseries description
 */
tsproc.prototype.getConfig = function(callback){

	if (callback){

		callback(null, this.getConfig());
	}
	else
		return this._config;
}

/**
 * Public method that returns the current number of timeseries in 
 * the tsproc module.
 *
 * @method getNbTS
 * @return {int} Number of timeseries available
 */
tsproc.prototype.getNbTS = function(){

	return this._timeseries.length;
}

/**
 * Public method that returns the number of documents in specified timeseries.
 * If there is no timeseries specified, returns the size of the first one.
 * 
 * @method getTSSize
 * @param {int} ts_index The timeseries index
 * @return {int} Size of the timeseries
 */
tsproc.prototype.getTSSize = function(ts_index){

	if (typeof ts_index !== 'undefined')
		return this._timeseries[ts_index].length;
	else
		return this._timeseries[0].length;
}

/**
 * Public method that returns the timestamp value (moment.js) of a specified document.
 *
 * @method getTimestamp
 * @param {int} ts_index The index of timeseries
 * @param {int} doc_index The index of the document in the timeseries
 * @return {Moment} A moment.js date
 */
tsproc.prototype.getTimestamp = function(ts_index, doc_index){

	//iso 8601
	if (this.isISO(ts_index))
		return moment.utc(this._timeseries[ts_index][doc_index][this.getTimestampField(ts_index)], ISO_FORMAT, true);

	//unix timestamp (seconds)
	if (this.isUNIX(ts_index))
		return moment.unix(this._timeseries[ts_index][doc_index][this.getTimestampField(ts_index)]);

	return moment.utc(this._timeseries[ts_index][doc_index][this.getTimestampField(ts_index)], this.getTimestampFormat(ts_index), true);
}

/**
 * Public method that returns the name of timestamp field of specified timeseries.
 *
 * @method getTimestampField
 * @param {int} ts_index The index of timeseries
 * @return {string} A timestamp field name
 */
tsproc.prototype.getTimestampField = function(ts_index){

	return this._config[ts_index].timestamp.name;
}

/**
 * Public method that returns a format of timestamp field of specified timeseries.
 *
 * @method getTimestampFormat
 * @param {int} ts_index The index of timeseries
 * @return {string} A timestamp format
 */
tsproc.prototype.getTimestampFormat = function(ts_index){

	return this._config[ts_index].timestamp.format;
}

/**
 * Public method that returns a single document from the timeseries.
 *
 * @method getDoc
 * @param {int} ts_index The index of timeseries
 * @param {int} doc_index The index of the document in the timeseries
 * @return {json} Requested document
 */
tsproc.prototype.getDoc = function(ts_index, doc_index){

	return this._timeseries[ts_index][doc_index];
}

/**
 * Public method that returns an empty document.
 * It is generated from a normal document (specified
 * by <code>ts_index</code> and <code>doc_index</code>) by emptying all the fields
 * except the timestamp.
 *
 * Used by <b>tsreductions</b> class.
 *
 * @method getEmptyDoc
 * @param {int} ts_index The index of timeseries
 * @param {int} doc_index The index of the document in the timeseries
 * 
 * @return {string} A document with empty fields except the timestamp
 */
tsproc.prototype.getEmptyDoc = function(ts_index, doc_index){

	//clone the doc
	var doc = JSON.parse(JSON.stringify(this.getDoc(ts_index, doc_index)));

	//initialize all the values to zero
	this.getFields(ts_index).forEach(function(field, index){

		doc[field] = 0; //TODO: what with the nominal fields?
	});

	return doc;
}

/**
 * Public method that takes a timestamp and returns (via <code>callback</code>) 
 * a document from the timeseries that corresponds to it.
 *
 * @method getDocByTimestamp
 * @param {int} ts_index The index of timeseries
 * @param {string} timestamp A string with date in ISO format
 * @param {function} callback A callback function
 */
tsproc.prototype.getDocByTimestamp = function(ts_index, timestamp, callback){

	var ts_size = this.getTSSize(ts_index);

	//to moment.js date
	var moment_date = moment.utc(timestamp, ISO_FORMAT, true);
	if (!moment_date.isValid()){

		if (callback)
			callback(new Error('Invalid date'), null);

		return;
	}

	var diff;
	for (var i=0; i<ts_size; i++){

		diff = this.getTimestamp(ts_index, i).diff(moment_date);

		if (diff == 0){

			if (callback)
				callback(null, this.getDoc(ts_index, i));

			return;
		}
	}

	if (callback)
		callback(null, null);
}


/**
 * Public method that returns an array of non-timestamp
 *  fields present in the specified timeseries 
 * (ie in each of it's documents).
 *
 * @method getFields
 * @param {int} ts_index The index of timeseries
 * @return {array} An array of field names
 */
tsproc.prototype.getFields = function(ts_index){

	var fields_out = [];

	if (typeof ts_index === 'undefined')
		ts_index = 0;

	//get fields
	var fields = this._config[ts_index].fields;
	var nb_fields = fields.length;

	//generate array
	for (var i=0; i<nb_fields; i++){
		fields_out.push(fields[i].name);
	}

	return fields_out;
}

/**
 * Public method that returns an average number of timestamps per day.
 * The timeseries should be merged.
 *
 * @method getAvgPerDay
 * @return {float} An average number of timestamps per day
 */
tsproc.prototype.getAvgPerDay = function(){

	//only if one timeseries (ie merged)
	if (this.getNbTS() === 1){

		//get the borders
		var min_date = getMinDate.call(this);
		var max_date = getMaxDate.call(this);

		//number of days between the two borders
		var nb_days = Math.ceil(max_date.diff(min_date, 'days', true));

		//timeseries size (number of instances)
		var ts_size = this.getTSSize();

		return ts_size/nb_days;
	}


	return 0;
}

/**
 * Public method that returns the date borders, which corresponds
 * to the earliest timestamp from all the timseries and the oldest timestamp 
 * from all the timeseries. 
 *
 * @method getBorders
 * @return {array} An array with date (string with ISO format) borders
 */
tsproc.prototype.getBorders = function(){

	var min_date = getMinDate.call(this);
	var max_date = getMaxDate.call(this);

	return [min_date.toISOString(), max_date.toISOString()];
}

/**
 * Public method that verifies wheather the timeseries is homogeneous.
 *
 * If there is only one timeseries, it is considered homogeneous.
 * If there are many, they are considered homogeneous if every timeseries
 * has the same timestamps at same positions. 
 *
 * @method isHomogeneous
 * @return {boolean} Wheather a set of timeseries is homogeneous
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     //homogeneous timeseries
 *     var ts = [
 *     		[{a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}, {a: 0.24, year:'2014'}],
 *    		    [{b: 21.42, year:'2012'}, {b: 23.11, year:'2013'}, {b: 0.11, year:'2014'}]
 *          ];
 *     var tsp = new tsproc(ts, config, null);
 *     console.log(tsp.isHomogeneous()); //true
 *
 *     //non homogeneous timeseries
 *     var ts = [
 *     		[{a: 21.07, year:'2012'}, {a: 0.24, year:'2014'}],
 *    		    [{b: 21.42, year:'2012'}, {b: 23.11, year:'2013'}, {b: 0.11, year:'2014'}]
 *          ];
 *     var tsp = new tsproc(ts, config, null);
 *     console.log(tsp.isHomogeneous()); //false
 */
tsproc.prototype.isHomogeneous = function(){

	var i,nb_ts = this.getNbTS();
	if (nb_ts === 1) return true;

	//array of TS sizes
	var sizes = new Array(nb_ts);
	for (i=0; i<nb_ts; i++){

		sizes[i] = this.getTSSize(i);
	}

	//if sizes are all equal
	var i1, i2, i3, m;
	if (underscore.uniq(sizes).length === 1){

		//generate 3 random indexes
		m = sizes[0];
		i1 = Math.floor(Math.random()*m);
		i2 = Math.floor(Math.random()*m);
		i3 = Math.floor(Math.random()*m);

		//check wheather the 3 random dates
		//from all the timeseries are equal
		var dates = [];
		for (i=0; i<nb_ts; i++){

			dates.push(this.getTimestamp(i, i1).toISOString());
			dates.push(this.getTimestamp(i, i2).toISOString());
			dates.push(this.getTimestamp(i, i3).toISOString());
		}

		//if there are from 1 to 3 uniq dates ==> homogeneous
		var nb_uniques = underscore.uniq(dates).length;
		if (nb_uniques > 0 && nb_uniques < 4){
			return true;
		}
	}

	return false;
}

/**
 * Public method that checks wheather the format of the timestamps in each
 * timeseries is correct.
 *
 * @method isValid
 * @return {boolean} Wheather the date format is correct 
 */
tsproc.prototype.isValid = function(){

	var n = this.getNbTS();
	var date;

	//checks only the date of first doc of each timeseries
	for (var i=0; i<n; i++){

		date = this.getTimestamp(i, 0);

		if (!date.isValid()){

			return false;
		}
	}

	return true;
}

/**
 * Public method that renames a field in the specified timeseries.
 *
 * @method renameField
 * @param {int} ts_index The index of a timeseries
 * @param {string} field_name A field to rename
 * @param {string} new_name A new field name
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 18.11, year:'2011'}, {a: 21.07, year:'2012'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     tsp.renameField(0, 'a', 'new_a', function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{new_a: 18.11, year: '2011'},
 *    			//		{new_a: 21.07, year: '2012'}
 *     		//  ],
 *     		//	[
 *    			//		{b: 26.42, year: '2012'},
 *    			//		{b: 24.11, year: '2013'}
 *     		//  ]
 *     		//]
 *     });
 */
tsproc.prototype.renameField = function(ts_index, field_name, new_name, callback){

	var ts_size = this.getTSSize(ts_index);
	var doc, tmp;

	for (var i=0; i<ts_size; i++){

		//save value
		doc = this.getDoc(ts_index, i);
		tmp = doc[field_name];

		//delete field
		delete doc[field_name];

		//add new one
		doc[new_name] = tmp;

		//change the name in the config
		this._config[ts_index].timestamp.name = new_name;
	}

	if (callback)
		callback(null, this.getTS());
}

/**
 * Public method that checks wheather the timestamps have ISO format.
 * The method checks only the format written in config json, it does not verify the timestamps
 * of all the documents.
 *
 * @method isISO
 * @param {int} ts_index The index of timeseries
 * @return {boolean} Wheather the timestamps have the ISO format
 */
tsproc.prototype.isISO = function(ts_index){

	//method checks only the config
	//it is not checking all the documents of the timeseries
	var format;

	if (typeof ts_index !== 'undefined'){

		format = this.getTimestampFormat(ts_index);
		return (format === ISO_FORMAT || format.toUpperCase() === String('iso').toUpperCase());
	}
	else{
		var nb_ts = this.getNbTS();
		for (var i=0; i<nb_ts; i++){

			format = this.getTimestampFormat(i);
			if (format !== ISO_FORMAT && format.toUpperCase() !== String('iso').toUpperCase()) //FIXME: it could be wrong
				return false;
		}

		return true;
	}
}

/**
 * Public method that checks wheather the timestamps have UNIX format.
 * The method checks only the format written in config json, it does not verify the timestamps
 * of all the documents.
 *
 * @method isUNIX
 * @param {int} ts_index The index of timeseries
 * @return {boolean} Wheather the timestamps are unix timestamps
 */
tsproc.prototype.isUNIX = function(ts_index){

	//method checks only the config
	//it is not checking all the documents of the timeseries
	var format;

	if (typeof ts_index !== 'undefined'){

		format = this.getTimestampFormat(ts_index);
		return (format.toUpperCase() === String('unix').toUpperCase());
	}
	else{
		var nb_ts = this.getNbTS();
		for (var i=0; i<nb_ts; i++){

			format = this.getTimestampFormat(i);
			if (format.toUpperCase() !== String('unix').toUpperCase()) //FIXME: it could be wrong
				return false;
		}

		return true;
	}
}

/**
* Public method that attribute <code>field</code>
* of the timeseries at <code>ts_index</code> is 
* nominal (not numeric) or not.
* @method isFieldNominal
* @param ts_index {integer} Index of a timeseries to check
* @param field {string} A field to check
* @return {boolean} True if the field is nominal, false if not
*/
tsproc.prototype.isFieldNominal = function(ts_index, field){

	if (typeof ts_index !== 'undefined' && typeof field !== 'undefined'){

		//get the the value of a field
		var doc = this.getDoc(ts_index, 0);
		if (doc[field]){

			var value = parseFloat(doc[field]);
			return isNaN(value) || typeof value !== 'number';
		}
	}
}

/**
 * Public method that checks wheather one of the timeseries
 * has a nominal field.
 *
 * @method isNominal
 * @return {boolean} Wheather one of the timeseries has a nominal field
 */
tsproc.prototype.isNominal = function(){

	var nb_fields, nb_ts = this.getNbTS();
	var fields;

	//for all the timeseries
	for (var i=0; i<nb_ts; i++){

		//get the fields of the timeseries
		fields = this.getFields(i);
		
		//check fields values
		nb_fields = fields.length;
		for (var j=0; j<nb_fields; j++){

			// value = parseFloat(this.getDoc(i, 0)[fields[j]]);
			if (this.isFieldNominal(i, fields[j])){

				return true;
			}
		}
	}

	return false;
}

/**
 * Public method that passes all the timestamps 
 * to the ISO format (YYYY-MM-DDTHH:mm:ss.SSSSZ).
 * The name of the timestamps is not changed.
 * 
 * @method toISO
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 18.11, year:'2011'}, {a: 21.07, year:'2012'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     tsp.toISO(function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{a: 18.11, year: '2011-01-01T00:00:00.000Z'},
 *    			//		{a: 21.07, year: '2012-01-01T00:00:00.000Z'}
 *     		//  ],
 *     		//	[
 *    			//		{b: 26.42, year: '2012-01-01T00:00:00.000Z'},
 *    			//		{b: 24.11, year: '2013-01-01T00:00:00.000Z'}
 *     		//  ]
 *     		//]
 *     });
 */
tsproc.prototype.toISO = function(callback){

	if (!this.isISO()){

		var i,j,date;

		//number of timeseries
		var ts_size,nb_ts = this._timeseries.length;

		for (i=0; i<nb_ts; i++){

			//number of documents in timeseries
			ts_size = this._timeseries[i].length;

			for (j=0; j<ts_size; j++){

				//get date in iso
				date = this.getTimestamp(i,j);

				//set date
				this._timeseries[i][j][this._config[i].timestamp.name] = date.toISOString();
			}

			//change the config
			this._config[i].timestamp.format = ISO_FORMAT;
		}

		if (callback)
			callback(null, this.getTS());
	}
}

/**
 * Public method that leaves in the 
 * timeseries only the documents between
 * two dates specified in the <code>date_borders</code> array
 *
 * @method cut
 * @param {array} date_borders An array of two dates 
 * (ISO strings)
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 18.11, year:'2011'}, {a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}, {b: 22.11, year:'2014'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     tsp.cut(['2012-01-01T00:00:00.000Z', '2013-01-01T00:00:00.000Z'], function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{a: 21.07, year: '2012-01-01T00:00:00.000Z'},
 *    			//		{a: 23.23, year: '2013-01-01T00:00:00.000Z'}
 *     		//  ],
 *     		//	[
 *    			//		{b: 26.42, year: '2012-01-01T00:00:00.000Z'},
 *    			//		{b: 24.11, year: '2013-01-01T00:00:00.000Z'}
 *     		//  ]
 *     		//]
 *     });
 */
tsproc.prototype.cut = function(date_borders, callback){

	var min_date, max_date;

	//time borders are specified
	if (date_borders && date_borders[0] && date_borders[1]){

		min_date = moment.utc(new Date(date_borders[0]));
		max_date = moment.utc(new Date(date_borders[1]));
	}
	//time borders are not specified
	else{

		min_date = getMinDate.call(this);
		max_date = getMaxDate.call(this);
	}

	if (!min_date.isValid() || !max_date.isValid()){

		if (callback)
			callback(new Error('Invalid borders'), null);

		return;
	}

	//cut everything out of bounderies
	//gaps are ignored
	cutBellowMin.call(this, min_date);

	cutAboveMax.call(this, max_date);

	if (callback)
		callback(null, this.getTS());
}

/**
 * Public method that merges two or more timeseries 
 * into one timeseries. The timeseries should be homogeneous.
 *
 * The result timeseries would have only one timestamp field
 * (it's name is specified by TIMESTAMP_FIELD proprety).
 *
 * @method merge
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     tsp.merge(function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *    			//	{a: 21.07, b: 26.42, time: '2012'},
 *    			//	{a: 23.23, b: 24.11, time: '2013'}
 *     		//]
 *     });
 */
tsproc.prototype.merge = function(callback){

	var i,j,doc,time;

	//number of timeseries queried
	var nb_ts = this.getNbTS();

	//if there is only one, return it
	if (nb_ts === 1) {

		if (callback)
			callback(null, this._timeseries[0]);

		return;
	}

	//only if timeseries are homogeneous
	if (this.isHomogeneous()){

		//fusing fields document by document
		var ts_size = this._timeseries[0].length;
		var merged_timeseries = [];
		for (j=0; j<ts_size; j++){

			//fusing fields into one document
			doc = {};
			time = this.getDoc(0,j)[this.getTimestampField(0)]; //save date before deleting
			for (i=0; i<nb_ts; i++){
				doc = underscore.extend(doc, this.getDoc(i, j));
				delete doc[this.getTimestampField(i)];
			}

			//adding fused document to dataset
			doc[TIMESTAMP_FIELD] = time;
			merged_timeseries.push(doc);
		}

		//merged timeseries
		this._timeseries = new Array(1);
		this._timeseries[0] = merged_timeseries;

		//also merge the config
		mergeConfigs.call(this);
	}

	if (callback)
		callback(null, this.getTS());

}

/**
 * Public method that reduces the number
 * of documents in the timeseries by different
 * methods. Applied only if the timeseries are homogeneous. And
 * only if the field values are numeric (non-nominal).
 * Uses a <b>tsreductions</b> module.
 *
 * The reduction mehtods are: 
 * - skip: choose one document (first) from <code>skipsize</code> documents
 * - sum: sum the values of <code>skipsize</code> documents into one
 * - avg: average the values of <code>skipsize</code> documents into one
 * - max: choose one document from <code>skipsize</code> documents with the maximum value of <code>target_field</code>
 * - min: choose one document from <code>skipsize</code> documents with the minimum value of <code>target_field</code>
 *
 * @method undersample
 * @param {int} type An index of ReduceEnum with reduction methods
 * @param {int} skipsize A number of documents to be reduced into one
 * @param {string} target_field A targeted field to calculate the max or min reduction
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}, {a: 24.24, year:'2014'}, {a: 25.25, year:'2015'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}, {b: 22.11, year:'2014'}, {b: 21.01, year:'2015'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     //simple skip (type = 0)
 *     tsp.undersample(0, 2, null, function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{a: 21.07, year: '2012'},
 *    			//		{a: 24.24, year: '2014'}
 *     		//  ],
 *     		//	[
 *    			//		{b: 26.42, year: '2012'},
 *    			//		{b: 22.11, year: '2014'}
 *     		//  ]
 *     		//]
 *     });
 *
 *     //max value of field 'a' (type = 3)
 *     tsp.undersample(3, 2, 'a', function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{a: 23.23, year: '2013'},
 *    			//		{a: 25.25, year: '2015'}
 *     		//  ],
 *     		//	[
 *    			//		{b: 26.42, year: '2012'},
 *    			//		{b: 22.11, year: '2014'}
 *     		//  ]
 *     		//]
 *     });
 */
tsproc.prototype.undersample = function(type, skipsize, target_field, callback){

	//neglect skipsize 0 and 1
	if (skipsize && skipsize > 1){

		//type is defined in ReduceEnum
		if (!type) type = ReduceEnum.skip;

		//if there are some nominal fields
		//and complexe reduction (not just skipping)
		//is applied
		if (this.isNominal() && type !== ReduceEnum.skip){

			if (callback)
				callback(new Error('Only the skip can be applied to the nominal timeseries'), this.getTS());

			return;
		}

		//apply a reduce function
		var reduced_timeseries = ReduceFunc[type].call(this, skipsize, target_field);
		if (reduced_timeseries){

			//recharge timeseries
			this._timeseries = reduced_timeseries;
		}

	}

	if (callback)
		callback(null, this.getTS());
}

/**
 * Public mehtod that could be applied for two or more timeseries
 * to interpolate the missing datapoints (documents) in relation to 
 * each other.
 *
 * Interpolation methods are: linear, cubic, lanczos, and neares neighbor.
 * Methods comparaison could be found <a href="http://osuushi.github.io/plotdemo016.html">here</a>.
 *
 * Timestamps should be the ISO strings and field values
 * should be numeric (non-nominal).
 * Uses a <b>tsinterp</b> module.
 *
 * @method interpolate
 * @param {int} type An index of InterpEnum with interpolation methods
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}, {a: 24.24, year:'2014'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}, {b: 21.01, year:'2015'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     //pass to iso timestamps
 *     tsp.toISO(null);
 *
 *     //linear interpolation (type = 0)
 *     tsp.interpolate(0, function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{year: '2012-01-01T00:00:00.000Z', a: 21.07},
 *    			//		{year: '2013-01-01T00:00:00.000Z', a: 23.23},
 *    			//		{year: '2014-01-01T00:00:00.000Z', a: 24.24},
 *    			//		{year: '2015-01-01T00:00:00.000Z', a: 0}
 *     		//  ],
 *     		//	[
 *    			//		{year: '2012-01-01T00:00:00.000Z', b: 26.42},
 *    			//		{year: '2013-01-01T00:00:00.000Z', b: 24.11},
 *    			//		{year: '2014-01-01T00:00:00.000Z', b: 22.560000000000002}
 *    			//		{year: '2015-01-01T00:00:00.000Z', b: 21.01}
 *     		//  ]
 *     		//]
 *     });
 *
 *     //cubic interpolation (type = 1)
 *     tsp.interpolate(1, function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{year: '2012-01-01T00:00:00.000Z', a: 21.07},
 *    			//		{year: '2013-01-01T00:00:00.000Z', a: 23.23},
 *    			//		{year: '2014-01-01T00:00:00.000Z', a: 24.24},
 *    			//		{year: '2015-01-01T00:00:00.000Z', a: 0}
 *     		//  ],
 *     		//	[
 *    			//		{year: '2012-01-01T00:00:00.000Z', b: 26.42},
 *    			//		{year: '2013-01-01T00:00:00.000Z', b: 24.11},
 *    			//		{year: '2014-01-01T00:00:00.000Z', b: 23.72875}
 *    			//		{year: '2015-01-01T00:00:00.000Z', b: 21.01}
 *     		//  ]
 *     		//]
 *     });
 *
 */
tsproc.prototype.interpolate = function(type, callback){

	var nb_ts = this.getNbTS();

	if (nb_ts > 1){

		//check if nominal
		if (this.isNominal()){

			if (callback)
				callback(new Error('Interpolation cannot be used for nominal timeseries'), this.getTS());

			return;
		}

		var smooth_conf={};
		var smoothers = new Array(nb_ts);

		//check date formats
		if (!this.isISO()){

			if (callback)
				callback(new Error('Dates should have iso format'), null);

			return;
		}

		//configurate timeseries interpolation
		smooth_conf.fields = [];
		smooth_conf.type = type;

		//learn the datapoints of each timeseries
		for (var i=0; i<nb_ts; i++){

			//config
			smooth_conf.timestamp_field = this.getTimestampField(i);
			this.getFields(i).forEach(function(field, index, array){
				smooth_conf.fields.push({'name': field});
			});

			//learn the timeseries
			smoothers[i] = new tsinterp(this._timeseries[i], smooth_conf, function(err){

				if (err) {callback(err, null); i=nb_ts;}
			});

			//empty config
			smooth_conf.fields = [];
		}

		//get all the possible dates
		var all_dates = getAllDates.call(this);
		var dates_size = all_dates.length;

		//interpolate all the timeseries
		//to the all possible dates
		var new_timeseries = new Array(nb_ts);
		for (var i=0; i<nb_ts; i++){

			new_timeseries[i] = [];
			for (var j=0; j<dates_size; j++){

				//get the interpolated document
				smoothers[i].smooth(all_dates[j], function(err, doc){

					if (err) { callback(err, null); i=nb_ts; j=dates_size; }
					if (doc) new_timeseries[i].push(doc);
				});
			}
		}

		//recharge the timeseries
		this._timeseries = new_timeseries;
	}

	if (callback)
		callback(null, this.getTS());
}

/**
 * Public mehtod that could be applied for two or more timeseries
 * to simplify them and leave only the documents that have the same
 * timestamps in different timeseries (cf example).
 *
 * Timestamps should be the ISO strings.
 *
 * @method intersect
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}, {a: 24.24, year:'2014'}],
 *    		    [{b: 26.42, year:'2012'}, {b: 24.11, year:'2013'}, {b: 21.01, year:'2015'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     //pass to iso timestamps
 *     tsp.toISO(null);
 *
 *     tsp.intersect(function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	[
 *    			//		{year: '2012-01-01T00:00:00.000Z', a: 21.07},
 *    			//		{year: '2013-01-01T00:00:00.000Z', a: 23.23}
 *     		//  ],
 *     		//	[
 *    			//		{year: '2012-01-01T00:00:00.000Z', b: 26.42},
 *    			//		{year: '2013-01-01T00:00:00.000Z', b: 24.11}
 *     		//  ]
 *     		//]
 *     });
 *
 */
tsproc.prototype.intersect = function(callback){

	var nb_ts = this.getNbTS();

	if (nb_ts > 1){

		//check date formats
		if (!this.isISO()){

			if (callback)
				callback(new Error('Dates should have iso format'), null);

			return;
		}

		//get the dates that
		//are used in every timeseries
		var dates = getSameDates.call(this);
		var dates_size = dates.length;

		//construct a new timeseries
		//with intersected dates
		var new_timeseries = new Array(nb_ts);
		for (var i=0; i<nb_ts; i++){

			new_timeseries[i] = [];
			for (var j=0; j<dates_size; j++){

				//get the document by its date
				this.getDocByTimestamp(i, dates[j], function(err, doc){

					if (err) { callback(err, null); i=nb_ts; j=nb_ts; }
					if (doc) new_timeseries[i].push(doc); //add
				});
			}
		}
		this._timeseries = new_timeseries;
	}

	if (callback)
		callback(null, this.getTS());
}

/**
 * @description
 * Public method that checks the local similarity
 * between the fields of a timeseries. Does this by caclulating
 * the local correlation.
 *
 * Timeseries should be merged (ie the function works only with 
 * a single timeseries) and have two non-timestamp fields.
 * The timeseries values should be non-nominal.
 * 
 * The similarity is indicated by adding a new field 'correlation' to each document.
 * If value of this field is not 'false', it means that a document is a part 
 * of a set of documents that are strongly correlated.
 * The correlation is considered strong if correalation coef is > 0.6.
 * 
 * More info about correlation can be found <a href="http://www.statisticshowto.com/what-is-the-correlation-coefficient-formula/">here</a>.
 *
 * @method checkSimilarity
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {}; //config example is in the tsproc method
 * 
 *     var ts = [
 *     		[{a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}, {a: 0.24, year:'2014'}, {a: 25.25, year:'2015'}, {a: 25.25, year:'2016'}, {a: 25.25, year:'2017'}],
 *    		    [{b: 21.42, year:'2012'}, {b: 23.11, year:'2013'}, {b: 0.11, year:'2014'}, {b: 21.01, year:'2015'}, {b: 4.5, year:'2016'}, {b: 35.2, year:'2017'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     //we can just merge (without interpolation) the timeseries
 *     //because they are homogeneous
 *     tsp.merge(null);
 *
 *     tsp.checkSimilarity(function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	{a: 21.07, b: 21.42, time: '2012', correlation: 0.9998},
 *     		//	{a: 23.23, b: 23.11, time: '2013', correlation: 0.9998},
 *     		//	{a: 0.24, b: 0.11, time: '2014', correlation: 0.9998},
 *     		//	{a: 25.25, b: 21.01, time: '2015', correlation: false},
 *     		//	{a: 25.25, b: 4.5, time: '2016', correlation: false},
 *     		//	{a: 25.25, b: 35.2, time: '2017', correlation: false} 
 *     		//]
 *     		//
 *     		// we can conclude that the first three document are strongly correlated
 *     });
 *
 */
tsproc.prototype.checkSimilarity = function(callback){

	//working only if correlation detection is demanded
	//and only with a merged timeseries 
	//with 2 timestamp fields
	if (this._correlation_activated && this.getNbTS() === 1 && this.getFields().length === 2){

		//check if nominal
		if (this.isNominal()){

			if (callback)
				callback(new Error('Similarity cannot be checked for nominal attributes'), this.getTS());

			return;
		}

		var ts_size = this.getTSSize();
		var values, coef, max;

		//going from left to right
		for (var i=0; i<ts_size-3; i++){

			//going from right to left
			for (var k=ts_size-1; k>i; k--){

				//do not check the correlation of 
				//two datapoints (it's eq 1)
				if (k - i === 1) continue;

				//get the values from a ragne
				values = extractValues.call(this, [i, k]);
				
				//calc the correlation coef
				var coef = getCorrelationCoef.call(this, values[0], values[1]);

				//get the absolute value of coef
				//this test does not have an impact on performance
				var coef_abs = (this._count_negative) ? Math.abs(coef) : coef;
				if (coef_abs > 0.6){

					if (this._max_coef){

						//finding the 'strongest' correlation
						//= stoping when the correlation is no more
						//augmenting
						do{

							//copy coef
							max = coef;

							//calc new coef
							k--;
							values = extractValues.call(this, [i, k]);
							coef = getCorrelationCoef.call(this, values[0], values[1]);

							//do not check the correlation of two datapoints
							if (k - i === 1) break;
						}
						while(coef > max);

						k++;
						coef = max;
					}

					//mark this range as correlated
					markCorrelation.call(this, [i, k], coef);

					//correlation detected
					//next search starts from
					//the next point
					i = k;

					break;
				}
			}
		}

		//mark all the other
		//non correlated docuemnts
		markCorrelation.call(this);
	}

	if (callback)
		callback(null, this.getTS());
}

/**
 * @description
 * Public method that is aplying the 
 * quantification to all the values 
 * of the timeseries (timestamps and normal).
 *
 * Timeseries should be merged (ie the function works only with a single timeseries),
 * timestamps should have an ISO format.
 * The non-numeric (nominal) fields are ignored.
 * 
 * @method quantize
 * @param {function} callback A callback function
 *
 * @example
 *     var tsproc = require('tsproc');
 *
 *     var config = {
 *     		"transform":{"type":"interp","interp_type":"linear"},
 *
 *     		"reduction":{"type":"skip","size":1,"target_field":""},
 *
 *     		"date_borders":{"from":{"date":""},"to":{"date":""}},
 *
 *     		"correlation":{"count_negative":false,"max_coef":true},
 *
 *     		"timeseries":
 * 	    		[
 * 					{
 * 					"fields":
 * 						[
 * 							{"name":"a", "quantum": 2}	//new field
 * 						],
 *
 * 					"timestamp":{"name":"year","format":"YYYY-MM", "quantum": "year"}
 * 					},
 *
 * 					{
 * 					"fields":
 * 						[
 * 							{"name":"b", "quantum": 2}	//new field
 * 						],	
 *
 * 					"timestamp":{"name":"year","format":"YYYY-MM", "quantum": "year"}
 * 					}
 * 				]
 * 		};
 * 
 *     var ts = [
 *     		[{a: 21.07, year:'2012-01'}, {a: 23.23, year:'2012-02'}, {a: 0.24, year:'2012-03'}, {a: 25.25, year:'2013-01'}, {a: 25.25, year:'2013-02'}, {a: 25.25, year:'2013-03'}],
 *    		    [{b: 21.42, year:'2012-01'}, {b: 23.11, year:'2012-02'}, {b: 0.11, year:'2012-03'}, {b: 21.01, year:'2013-01'}, {b: 4.5, year:'2013-02'}, {b: 35.2, year:'2013-03'}]
 *          ];
 *     
 *     var tsp = new tsproc(ts, config, null);
 *
 *     //we can just merge (without interpolation) the timeseries
 *     //because they are homogeneous
 *     tsp.merge(null);
 *     tsp.toISO(null);
 *
 *     //launch the quantification
 *     tsp.quantize(function(err, timeseries){
 *	
 *	   		if (timeseries) console.log(timeseries);
 *     		//the result is:
 *     		//[
 *     		//	{a: 20, b: 20, time: '2012-01-01T00:00:00.000Z'},
 *     		//	{a: 22, b: 22, time: '2012-01-01T00:00:00.000Z'},
 *     		//	{a: 0, b: 0, time: '2012-01-01T00:00:00.000Z'},
 *     		//	{a: 24, b: 20, time: '2013-01-01T00:00:00.000Z'},
 *     		//	{a: 24, b: 4, time: '2013-01-01T00:00:00.000Z'},
 *     		//	{a: 24, b: 34, time: '2013-01-01T00:00:00.000Z'} 
 *     		//]
 *     		//
 *     		// we can conclude that values were rounded to 2, and dates to the year
 *     });
 *
 */
tsproc.prototype.quantize = function(callback){

	//only for merged timeseries
	//with iso timestamps
	if (this.getNbTS() === 1 && this.isISO()){

		var doc,quantum;

		//start with quantification of the non-timestamp fields
		var fields = this.getFields();
		var nb_fields = fields.length;
		var nb_docs = this.getTSSize();
		for (var i=0; i<nb_fields; i++){

			//get the quantum
			quantum = getQuantum.call(this, 0, i);
			if (quantum > 0 && !this.isFieldNominal(0, fields[i])){

				//go through all the documents
				for (var j=0; j<nb_docs; j++){

					//get the document
					doc = this.getDoc(0,j);

					//quantize
					doc[fields[i]] = Math.floor(doc[fields[i]]/quantum)*quantum; 
				}
			}
		}

		//quantize the timestamps
		var ts_quantum = getTSQuantum.call(this);
		var timestamp, year, month, day;
		if (ts_quantum !== QuantTSEnum.none){

			//go through all the documents
			for (var j=0; j<nb_docs; j++){

				//get the timestamp
				timestamp = this.getTimestamp(0, j); //timestamp is a moment.js date

				//get the date
				year = timestamp.year();
				month = timestamp.month() + 1;
				day = timestamp.date();

				//filter
				if (ts_quantum === QuantTSEnum.year){

					month = 1;
					day = 1;
				}
				if (ts_quantum === QuantTSEnum.month){

					day = 1;
				}

				//create new timestamp
				var new_timestamp = moment.utc(year + '-' + month + '-' + day, 'YYYY-MM-DD');

				//set the new timestamp
				this._timeseries[0][j][this.getTimestampField(0)] = new_timestamp.toISOString();
			}
		}
	}

	if (callback)
		callback(null, this.getTS());
}

/**
 * Private method that merges the configuration of 
 * multiple timeseries into one.
 * The final timestamp name is defined by the 
 * TIMESTAMP_FIELD proprety.
 *
 * @method mergeConfigs
 * @private
 */
function mergeConfigs(){

	//only if the timeseries are
	//homogeneous
	if (this.isHomogeneous()){

		var new_config = [{}];

		//copy the timestamp
		new_config[0].timestamp = this._config[0].timestamp;

		//rename the timestamp field
		new_config[0].timestamp.name = TIMESTAMP_FIELD;

		//copy the fields
		var config_size = this._config.length;
		var fields = [];
		for (var i=0; i<config_size; i++){

			this._config[i].fields.forEach(function(field_conf, index){

				fields.push({
								'name': field_conf.name,
								'quantum': field_conf.quantum
							});
			});
		}
		new_config[0].fields = fields;
		this._config = new_config;
	}

}

/**
 * Private method that returns the minimal (the earliest)
 * date of all the timeseries.
 *
 * @method getMinDate
 * @private
 * @return {moment} A moment.js date
 */
function getMinDate(){

	var i;

	//number of timeseries
	var nb_ts = this.getNbTS();

	//getting the minimal dates of each timeseries
	var dates = new Array(nb_ts);
	for (i=0; i<nb_ts; i++){

		dates[i] = this.getTimestamp(i, 0);
	}

	//returning the min date
	return moment.min(dates);
}

/**
 * Private method that returns the maximal (the oldest)
 * date of all the timeseries.
 *
 * @method getMaxDate
 * @private
 * @return {moment} A moment.js date
 */
function getMaxDate(){

	var i;

	//number of timeseries
	var nb_ts = this.getNbTS();

	//getting the maximal dates of each timeseries
	var dates = new Array(nb_ts);
	for (i=0; i<nb_ts; i++){

		dates[i] = this.getTimestamp(i, this.getTSSize(i) - 1);
	}

	//returning the max date
	return moment.max(dates);
}

/**
 * Private method that cuts in a specified timeseries all the documents
 * that are bellow the specified index.
 * Index is included in a cut.
 *
 * @method cutBellow
 * @private
 * @param {int} ts_index An index of a timeseries to cut
 * @param {int} index An index bellow which to cut
 */
function cutBellow(ts_index, index){

	this._timeseries[ts_index] = this._timeseries[ts_index].slice(index);
}

/**
 * Private method that cuts in a specified timeseries all the documents
 * that are above the specified index.
 * Index is included in a cut.
 *
 * @method cutAbove
 * @private
 * @param {int} ts_index An index of a timeseries to cut
 * @param {int} index An index above which to cut
 */
function cutAbove(ts_index, index){

	this._timeseries[ts_index] = this._timeseries[ts_index].slice(0, index+1);
}

/**
 * Private method that cuts in all the 
 * timeseries the documents that are earlier 
 * than <code>max_date</code>.
 *
 * @method cutAboveMax
 * @private
 * @param {moment} max_date A moment.js date 
 */
function cutAboveMax(max_date){

	var i,j;

	//number of timeseries queried
	var ts_size,nb_ts = this.getNbTS();

	//difference between current date and min_date
	var diff;

	//date from timeseries
	var tmp,date;

	//cut documents above max_date
	//of all timeseries
	for (i=0; i<nb_ts; i++){

		//iterate through documents and check the date
		ts_size = this.getTSSize(i);
		for (j=ts_size-1; j>=0; j--){

			//date from timeseries
			date = this.getTimestamp(i,j);

			//calculating difference between date and maximal date max_date
			diff = max_date.diff(date);

			//dates are equal
			//needed maximal date have been reached
			if (diff == 0){

				//delete all above
				cutAbove.call(this, i, j);
				break;
			}

			//date from timeseries is less than max_date
			if (diff > 0){

				cutAbove.call(this, i, j);
				break;
			}
		}
	}
}

/**
 * Private method that cuts in all the 
 * timeseries the documents that are older 
 * than <code>min_date</code>.
 *
 * @method cutBellowMin
 * @private
 * @param {moment} min_date A moment.js date 
 */
function cutBellowMin(min_date){

	var i,j;

	//number of timeseries queried
	var ts_size,nb_ts = this.getNbTS();

	//difference between current date and min_date
	var diff;

	//date from timeseries
	var date;

	//cut documents bellow min_date
	//of all timeseries
	for (i=0; i<nb_ts; i++){

		//iterate through documents and check the date
		ts_size = this.getTSSize(i);
		for (j=0; j<ts_size; j++){

			//date from timeseries
			date = this.getTimestamp(i,j);

			//calculating difference between date and minimal date min_date
			diff = min_date.diff(date);

			//dates are equal
			//needed minimal date have been reached
			if (diff == 0){

				//delete all bellow
				cutBellow.call(this, i, j);
				break;
			}

			//date from timeseries is bigger than min_date
			//documents missing
			if (diff < 0){

				cutBellow.call(this, i, j);
				break;
			}
		}
	}
}

/**
 * Private method that returns an array
 * of all the possible dates of all the timeseries (without duplication).
 *
 * The timestamps of all the timeseries shoud be the ISO strings.
 * Final array of dates is sorted chronologically.
 *
 * @method getAllDates
 * @private
 * @return {array} An array of all possible dates (ISO strings) in all the timeseries
 * 
 * @example
 *	
 *     //[[{a: 18.01, year:'2011-01-01T00:00:00.000Z'}, {a: 21.07, year:'2012-01-01T00:00:00.000Z'}], [{b: 21.42, year:'2012-01-01T00:00:00.000Z'}, {b: 23.11, year:'2013-01-01T00:00:00.000Z'}]]
 *     console.log(getAllDates.call(this)); //['2011-01-01T00:00:00.000Z', '2012-01-01T00:00:00.000Z', '2013-01-01T00:00:00.000Z']
 *
 */
function getAllDates(){

	var nb_ts = this.getNbTS();
	var all_dates = [];

	//working only with ISO strings
	if (this.isISO()){

		//accumulate all the dates
		//only singletons are leaved
		for (var i=0; i<nb_ts; i++){

			all_dates = underscore.union(all_dates, getTSDates.call(this, i));
		}

		//sort by date
		all_dates = underscore.sortBy(all_dates, function(date){

			return moment.utc(date, null, true).valueOf();
		});
	}

	return all_dates;
}

/**
 * Private method that returns an array
 * of dates that are part of all the timeseries.
 *
 * The timestamps of all the timeseries shoud be the ISO strings.
 *
 * @method getSameDates
 * @private
 * @return {array} An array of dates (ISO strings) that are part of all timeseries
 * 
 * @example
 *	
 *     //[[{a: 18.01, year:'2011-01-01T00:00:00.000Z'}, {a: 21.07, year:'2012-01-01T00:00:00.000Z'}], [{b: 21.42, year:'2012-01-01T00:00:00.000Z'}, {b: 23.11, year:'2013-01-01T00:00:00.000Z'}]]
 *     console.log(getSameDates.call(this)); //['2012-01-01T00:00:00.000Z']
 *
 */
function getSameDates(){

	var nb_ts = this.getNbTS();
	var same_dates = getTSDates.call(this, 0);

	//working only with ISO strings
	if (this.isISO()){

		//leave only intersected dates
		for (var i=1; i<nb_ts; i++){

			same_dates = underscore.intersection(same_dates, getTSDates.call(this, i));
		}
	}

	return same_dates;
}

/**
 * Private method that returns an array
 * of all the dates present in a specified timeseries.
 *
 * @method getTSDates
 * @private
 * @param {int} ts_index An index of a timeseries to extract the dates
 * @return {array} An array of dates from a specific timeseries
 * @example
 *	
 *     //[[{a: 18.01, year:'2011-01-01T00:00:00.000Z'}, {a: 21.07, year:'2012-01-01T00:00:00.000Z'}], [{b: 21.42, year:'2012-01-01T00:00:00.000Z'}, {b: 23.11, year:'2013-01-01T00:00:00.000Z'}]]
 *     console.log(getTSDates.call(this, 0)); //['2011-01-01T00:00:00.000Z', '2012-01-01T00:00:00.000Z']
 *
 */
function getTSDates(ts_index){

	//timestamp field
	var field = this._config[ts_index].timestamp.name;
	var dates_array = new Array(this._timeseries[ts_index].length);

	//extracting dates
	this._timeseries[ts_index].forEach(function(document, index, array){

		dates_array[index] = document[field];
	});

	return dates_array;
}

/**
 * A private method that exracts an array of values of all
 * the documents in a timeseries.
 *
 * The function works only with merged timeseries.
 *
 * @method extractValues
 * @private
 * @param {array} borders An array of indexes between which the values should be extracted
 * @return {array} An array of values
 * 
 * @example
 *	
 *     //[{a: 18.01, year:'2011'}, {a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}]
 *     console.log(extractValues.call(this)); //[[18.01], [21.07], [23.23]]
 *     console.log(extractValues.call(this, [1,2])); //[[21.07], [23.23]]
 *
 */
function extractValues(borders){

	var values;
	var ts_size = this.getTSSize();

	//acepting only one TS
	if (this.getNbTS() === 1){

		//calc the indexes
		var start_index, end_index;
		if (borders && borders.length === 2){

			start_index = borders[0];
			end_index = borders[1];

			if ( (start_index >= end_index) || start_index < 0 || end_index > ts_size )
				return [];
		}
		else{

			start_index = 0;
			end_index = ts_size - 1;
		}

		//get all the fields of a document
		var fields = this.getFields(0);

		//values container
		var nb_fields = fields.length;
		values = new Array(nb_fields);
		for (var j=0; j<nb_fields; j++){
			values[j] = new Array();
		}

		//extracting
		var doc;
		for (var i=start_index; i<=end_index; i++){

			doc = this.getDoc(0, i);
			for (var j=0; j<nb_fields; j++){

				values[j].push(+doc[fields[j]]);
			}
		}
	}

	return values;
}

/**
 * A private method that calculates the correlation coefficient
 * between two arrays of digits. 
 *
 * Using <a href="http://www.statisticshowto.com/what-is-the-correlation-coefficient-formula/">this</a>
 * correlation formula.
 *
 * @method getCorrelationCoef
 * @private
 * @param {array} array1 First array of digits to count the correlation
 * @param {array} array2 Second arrya of digits to count the correlation
 * @return {flooat} A correlation coefficient
 * 
 * @example
 *	
 *      console.log(getCorrelationCoef.call(this, [1, 2, 3, 4, 5, 6], [2, 2, 3, 4, 5, 60])); //0.69
 */
function getCorrelationCoef(array1, array2){

	var coef = null;

	if (array1 && array1.length && array2 && array2.length){

		var n = array1.length;
		var sum_xy = 0;
		var sum_x=0, sum_y=0;
		var sum_x2=0, sum_y2=0;
		var x,y;

		//calculate the sums
		for (var i=0; i<n; i++){

			//values
			x = array1[i];
			y = array2[i];

			//sums
			sum_xy += (x*y);

			sum_x += x;
			sum_y += y;

			sum_x2 += (x*x);
			sum_y2 += (y*y);
		}
		
		//caclulate the correlation coef
		coef = ((n*sum_xy - sum_x*sum_y) / (Math.sqrt( (n*sum_x2 - sum_x*sum_x) * (n*sum_y2 - sum_y*sum_y) ))).toFixed(4);
	}

	return coef;
}

//mark the value of correlation corr_value
//to every document in the range
/**
 * A private method that adds to the set of documents 
 * (specified by the <code>borders</code>) a field 'correlation' with value
 * <code>corr_value</code> (cf example).
 *
 * If no borders are specified, the field would be added
 * to all of the documents of the timeseries.<br/>
 * If no correlation value is specified the 'false' would
 * be attributed.
 *
 * The method works only with merged timeseries and only if 
 * there are at least 2 non-timestamp fields.
 *
 * @method markCorrelation
 * @private
 * @param {array} borders An array of indexes between which the correlation should be marked
 * @param {float} corr_value The correlation value to add
 * 
 * @example
 *	
 *     //[{a: 18.01, year:'2011'}, {a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}]
 *     markCorrelation.call(this, [1,2], 0.9); console.log(this.getTS()); //[{a: 18.01, year:'2011'}, {a: 21.07, year:'2012', correlation: 0.9}, {a: 23.23, year:'2013', correlation: 0.9}]
 *     markCorrelation.call(this); console.log(this.getTS()); //[{a: 18.01, year:'2011', correlation: false}, {a: 21.07, year:'2012', correlation: 0.9}, {a: 23.23, year:'2013', correlation: 0.9}]
 *
 *     //[{a: 18.01, year:'2011'}, {a: 21.07, year:'2012'}, {a: 23.23, year:'2013'}]
 *     markCorrelation.call(this); console.log(this.getTS()); //[{a: 18.01, year:'2011', correlation: false}, {a: 21.07, year:'2012', correlation: false}, {a: 23.23, year:'2013', correlation: false}]
 */
function markCorrelation(borders, corr_value){

	//working only with a merged timeseries 
	//with more than one non timestamp fields
	if (this.getNbTS() === 1 && this.getFields(0).length > 1){

		var ts_size = this.getTSSize();
		var field_name = 'correlation';

		//correlation value
		//if there is no correlation
		//it's value is equals to false
		var correlation = (corr_value) ? +corr_value : false;

		//calc the indexes
		var start_index, end_index;
		if (borders && borders.length === 2){

			start_index = borders[0];
			end_index = borders[1];

			if ( (start_index >= end_index) || start_index < 0 || end_index > ts_size )
				return;
		}
		else{

			start_index = 0;
			end_index = ts_size - 1;
		}

		//marking
		var doc;
		for (var i=start_index; i<=end_index; i++){ //end_index is an index, not length

			doc = this.getDoc(0, i);

			//if correlation not yet set
			if (!doc[field_name])
				doc[field_name] = correlation;
		}
	}
}

/**
 * Private method that returns
 * the size of a quantum by wich
 * the field should be quantized.
 * The quantum value is read from
 * the config JSON.
 *
 * @method getQuantum
 * @private
 * @param {integer} ts_index Index of the timeseries where the field is
 * @param {interger} field_index Index of the field to get the quantum
 * @return A quantum of a field 
 */
function getQuantum(ts_index, field_index){

	if (typeof field_index === 'undefined') field_index = 0;
	if (typeof ts_index === 'undefined') ts_index = 0;

	//if quantum field is specified
	if (this._config[ts_index].fields[field_index].quantum)
		return this._config[ts_index].fields[field_index].quantum;
	else
		return 0;

}

/**
 * Private method that returns
 * the size of a quantum by wich
 * the timestamp field should be quantized.
 * The quantum value is read from
 * the config JSON.
 * <br/>
 * For the timestamp fields, 
 * the possible values are:
 * - 'none'
 * - 'day'
 * - 'month'
 * - 'year'
 *
 * @method getTSQuantum
 * @private
 * @param {integer} ts_index Index of the timeseries where the timestamp field is
 * @param {interger} field_index Index of the timestamp field to get the quantum
 * @return A quantum of a timestamp field 
 */
function getTSQuantum(ts_index){

	if (typeof ts_index === 'undefined') ts_index = 0;

	//if quantum field is specified
	if (this._config[ts_index].timestamp.quantum)
		return this._config[ts_index].timestamp.quantum;
	else
		return QuantTSEnum.none;
}

module.exports = tsproc;
