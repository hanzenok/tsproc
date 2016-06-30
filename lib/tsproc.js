var moment = require('moment');
var underscore = require('underscore');
var tsinterp = require('./tsinterp');
var tsreductions = require('./tsreductions');

var ISO_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSSSZ'; //standart ISO format
var TIMESTAMP_FIELD = 'time'; //default timestamp field name
var InterpEnum = {'linear': 0, 'cubic': 1, 'lanczos': 2, 'nearest': 3};
var ReduceEnum = {'skip': 0, 'sum': 1, 'avg': 2, 'max': 3, 'min': 4};
var ReduceFunc = tsreductions;

/**
 * Timeseries processor is a class that works
 * with timeseries and offers different methods
 * to process it.
 *
 * @module tsproc
 * @class tsproc
 * @constructor
 */

/**
 * A public constructor that is used to initiate 
 * the class. It takes in an array of timeseries.
 * @method tsproc
 * @param {array} timeseries An array of timeseries
 * @param {json} config A description of each timeseries
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
 *    		    [{b: 26.42, year:'2012'}, {b: 21.07, year:'2013'}]
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
			err_callback(new Error('Timseries or config are not set'));

		return;
	}
}

/**
 * A main public method that processes the array of timeseries. It returns (via callback) a one timeseries with timestamp field 'time' in the
 * ISO format. This timeseries correspond to the fusion of an array of timeseries, and if they are not homogeneous the interpolation would be applyed.
 *
 * <br/>The processing takes the next steps:
 * - if the borders(min and max dates) are specified in the config file, the timeseries would be cut
 * - all the dates would be transformed to the ISO string
 * - if there are multiple timeseries, and they are not homogeneous, all the timseries would be interpolated or intersected
 * (ie leaving only the documents with dates that are present in all the timeseries)
 * - if the are multiple timeseries, they would be fused into one timeseries document by document
 * - the output timeseries the timestamp field would be called 'time'
 * - finally, if the skip value is defined, the timeseries would undersampled to decrease the size of the timeseries 
 * 
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
 *     tsp.process(function(err, timseries){
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
 * Public method that returns one timeseries it there is one, on an array
 * if trere are many.
 *
 * @method getTS
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
 * Public method that returns a timeseries config json.
 *
 * @method getConfig
 * @return {json} Timeseries description
 */
tsproc.prototype.getConfig = function(){

	return this._config;
}

/**
 * Public method that returns the current number of timeseries in 
 * the tsproc.
 *
 * @method getNbTS
 * @return {int} Number of current timeseries
 */
tsproc.prototype.getNbTS = function(){

	return this._timeseries.length;
}

/**
 * Public method that returns the number of documents in the queried timeseries
 * If there is no timeseries specified, return the size of the first one.
 * @method getTSSize
 * @param {int} ts_index The timeseries index
 * @return {int} Size of the timeseries
 */
tsproc.prototype.getTSSize = function(ts_index){

	if (ts_index)
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
 * @return {Moment} A timestamp
 */
tsproc.prototype.getTimestamp = function(ts_index, doc_index){

	if (this.isISO(ts_index))
		return moment.utc(this._timeseries[ts_index][doc_index][this.getTimestampField(ts_index)], ISO_FORMAT, true);

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
 * Public method that returns the format of timestamp field of specified timeseries.
 *
 * @method getTimestampFormat
 * @param {int} ts_index The index of timeseries
 * @return {string} A timestamp format
 */
tsproc.prototype.getTimestampFormat = function(ts_index){

	return this._config[ts_index].timestamp.format;
}

/**
 * Public method that returns one document from the timeseries.
 *
 * @method getTimestampField
 * @param {int} ts_index The index of timeseries
 * @param {int} doc_index The index of the document in the timeseries
 * @return {json} Requested document
 */
tsproc.prototype.getDoc = function(ts_index, doc_index){

	return this._timeseries[ts_index][doc_index];
}

/**
 * Public method that returns an empty document.
 * It is generated from a normal doucment (specified
 * by ts_index and doc_index) by emptying all the fields
 * except the timestamp
 * Used by tsreductions class.
 *
 * @method getEmptyDoc
 * @param {int} ts_index The index of timeseries
 * @param {int} doc_index The index of the document in the timeseries. Used to 
 * 
 * @return {string} A document with empty fields
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
 * Public method that takes a timestamp and returns a document from
 * the timeseries that corresponds to it.
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
 * Public method that returns an array of fields present in the specified timeseries (ie in each of it's document).
 *
 * @method getFields
 * @param {int} ts_index The index of timeseries
 * @return {array} An array of field names
 */
tsproc.prototype.getFields = function(ts_index){

	var fields = this._config[ts_index].fields;
	var i,nb_fields = fields.length;
	var fields_out = [];

	for (i=0; i<nb_fields; i++){
		fields_out.push(fields[i].name);
	}

	return fields_out;
}

/**
 * Public method that returns an average number of timestamps per day.
 * The timeseries should be homogeneous.
 *
 * @method getAvgPerDay
 * @return {float} An average number of timestamps per day
 */
tsproc.prototype.getAvgPerDay = function(){

	//only if homogeneous
	if (this.isHomogeneous()){

		//and only if one timeseries
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
	}

	return 0;
}

/**
 * Public method that returns the date border (the earliest and the oldest timestamp) in 
 * all the timeseries.
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
 * If there is only one timeseries, it is homogeneous
 * If there are many, they are considered homogeneous if every timeseries
 * has the same timestamps in the same order. 
 *
 * @method isHomogeneous
 * @return {boolean} Wheather a bunch of timeseries are homogeneous
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
 * Public method that checks wheather the format of the dates in each
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
 * Public method that renames a field in the specified timeseries
 *
 * @method renameField
 * @param {int} ts_index The index of timeseries
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
 * The method checks only the config json, it does not verify the timestamps
 * of all documents.
 *
 * @method isISO
 * @param {int} ts_index The index of timeseries
 * @return {boolean} Wheather the timestamp have the ISO format
 */
tsproc.prototype.isISO = function(ts_index){

	//method check only the config
	//it is not checking all the documents of the timeseries
	var format;

	if(ts_index !== undefined){

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

	if(!this.isISO()){

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
 * Public method used to leave in the 
 * timeseries only the documents between
 * two dates specified in the date_borders array
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
	//time borders are specified
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
 * Public method used to merge two or more timeseries 
 * into one timeseries. The timeseries should be homogeneous.
 * The result timeseries would have only one timestamp field 
 * (it's name is specified by TIMESTAMP_FIELD variable).
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
	if(this.isHomogeneous()){

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

		//merged timseries
		this._timeseries = new Array(1);
		this._timeseries[0] = merged_timeseries;

		//also merge the config
		mergeConfigs.call(this);
	}

	if (callback)
		callback(null, this.getTS());

}

tsproc.prototype.undersample = function(type, skipsize, target_field, callback){

	if(skipsize && skipsize > 1){

		if(!type) type = 0;

		var reduced_timseries = ReduceFunc[type].call(this, skipsize, target_field);
		if(reduced_timseries){

			this._timeseries = reduced_timseries;

		}

	}

	if (callback)
		callback(null, this.getTS());
}

//type [0..3] = type of interploation
	//FIXME: ignore if there is only one timeseries
tsproc.prototype.interpolate = function(type, callback){

	var nb_ts = this.getNbTS();
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

			if(err) {callback(err, null); i=nb_ts;}
		});

		//empty config
		smooth_conf.fields = [];
	}

	//get all the possible dates
	var all_dates = getAllDates.call(this);
	var dates_size = all_dates.length;

	//interpolate all the timeseries
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
	this._timeseries = new_timeseries;

	if (callback)
		callback(null, this.getTS());
}

tsproc.prototype.intersect = function(callback){

	//get the dates that
	//are used in every timeseries
	var dates = getSameDates.call(this);

	//nb of timeseries and dates
	var nb_ts = this.getNbTS();
	var dates_size = dates.length;

	var new_timeseries = new Array(nb_ts);
	for (var i=0; i<nb_ts; i++){

		new_timeseries[i] = [];
		for (var j=0; j<dates_size; j++){

			this.getDocByTimestamp(i, dates[j], function(err, doc){

				if (err) { callback(err, null); i=nb_ts; j=nb_ts; }
				if (doc) new_timeseries[i].push(doc);
			});
		}
	}
	this._timeseries = new_timeseries;

	if (callback)
		callback(null, this.getTS());
}

//works only with merged timeseries (= interpolated, without gaps)
//uses interpolation coef to check the local similarity between datapoints
tsproc.prototype.checkSimilarity = function(callback){

	//working only if correlation detection is demanded
	//and only with a merged timeseries 
	//with more than one non timestamp fields
	if (this._correlation_activated && this.getNbTS() === 1 && this.getFields(0).length > 1){

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
				coef = (this._count_negative) ? Math.abs(coef) : coef; //this test does not have an impact on performance
				if (coef > 0.6){

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

			this.getFields(i).forEach(function(field, index){

				fields.push({'name': field});
			});
		}
		new_config[0].fields = fields;
		this._config = new_config;
	}

}

//get min date out of all the timeseries
//dataset is supposed to be sorted
//returns a Moment
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

//get max date out of all the timeseries
//dataset is supposed to be sorted
//returns a Moment
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

//cut all the elements bellow index (index included)
function cutBellow(ts_index, index){

	this._timeseries[ts_index] = this._timeseries[ts_index].slice(index);

}

//cut all the elements above the index (index included)
function cutAbove(ts_index, index){

	this._timeseries[ts_index] = this._timeseries[ts_index].slice(0, index+1);
}

//cut all the dates above the max_date
//if there are gaps after max_date, ignore them
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

//cut all the dates bellow the min_date
//if there are gaps before min_date, ignore them
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

//all the possible string utc dates
//of all the timeseries
//sorting is applyed
function getAllDates(){

	var nb_ts = this.getNbTS();
	var all_dates = [];

	for (var i=0; i<nb_ts; i++){

		all_dates = underscore.union(all_dates, getCollDates.call(this, i));
	}

	//sort by date
	all_dates = underscore.sortBy(all_dates, function(d){

		return moment.utc(d, null, true).valueOf();
	});

	return all_dates;
}

//returns the dates that
//are present in each timeseries
function getSameDates(){

	var nb_ts = this.getNbTS();
	var same_dates = getCollDates.call(this, 0);

	for (var i=1; i<nb_ts; i++){

		same_dates = underscore.intersection(same_dates, getCollDates.call(this, i));
	}

	return same_dates;
}

//returns an array with all the dates
//from the timeseries
function getCollDates(ts_index){

	var field = this._config[ts_index].timestamp.name;

	var dates_array = new Array(this._timeseries[ts_index].length);

	this._timeseries[ts_index].forEach(function(document, index, array){

		dates_array[index] = document[field];
	});

	return dates_array;
}

//[{a:2, b:5, time:1911}, {a:3, b:4, time:1912}, {a:4, b:6, time:1913}] ==> extractValues() ==> [[2, 3, 4], [5, 4, 6]]
//[{a:2, b:5, time:1911}, {a:3, b:4, time:1912}, {a:4, b:6, time:1913}] ==> extractValues([1, 2]) ==> [[3, 4], [4, 6]]
//works only with merged timeseries i.e. when (this.getNbTS() === 1)
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

		//all the fields of a document
		var fields = this.getFields(0);

		//value container
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

//getCorrelationCoef([1, 2, 3, 4, 5, 6], [2, 2, 3, 4, 5, 60]) ==> 0.69
//http://www.statisticshowto.com/what-is-the-correlation-coefficient-formula/
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

module.exports = tsproc;
