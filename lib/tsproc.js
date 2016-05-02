var moment = require('moment');
var underscore = require('underscore');
var tsinterp = require('./tsinterp');

var ISO_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSSSZ'; //standart format
var TIMESTAMP_FIELD = 'time'; //default timestamp field name
var InterpEnum = {'linear': 0, 'cubic': 1, 'lanczos': 2, 'nearest': 3};
var ReduceEnum = {'skip': 0, 'sum': 1, 'avg': 2, 'max': 3, 'min': 4};
var ReduceFunc = [reduceSkip, reduceSum, reduceAvg, reduceMax, reduceMin];

function tsproc(timeseries, config, err_callback){

	if (timeseries && config){

		//save config
		if (config){

			this._config = config.timeseries;
			this._interp_type = (config.interpolation) ? config.interpolation.type : 'linear';
			this._reduction_type = (config.reduction) ? config.reduction.type : 'skip';
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

		err_callback(new Error('Timseries or config are not set'));
		return;
	}
}

tsproc.prototype.process = function(date_borders, callback){

	var err_callback = function(err){if (err) callback(err);}

	//preprocess
	this.cut(date_borders, err_callback);
	this.toUTC(err_callback);
	
	//process if timeseries are not homogeneous
	var is_homog = this.isHomogeneous();
	if (!is_homog){
		
		//this.intersect(callback);
		this.interpolate(InterpEnum[this._interp_type], err_callback);
	}
	
	//merge all TS
	this.merge(err_callback);

	console.log(this.getTSSize(0));
	this.undersample(ReduceEnum[this._reduction_type], 1, null/*Math.ceil(this.getTSSize()/2000)*/, err_callback);
	console.log(this.getTSSize(0));

	callback(null, this.getData());
}

tsproc.prototype.getData = function(){

	if (this.getNbTS() === 1) return this._timeseries[0];
	else return this._timeseries;
}

tsproc.prototype.getConfig = function(){

	return this._config;
}

tsproc.prototype.getNbTS = function(){
	
	return this._timeseries.length;
}

tsproc.prototype.getTSSize = function(coll_index){
	
	if (coll_index)
		return this._timeseries[coll_index].length;

	else
		return this._timeseries[0].length;
}

//return moment.js date
tsproc.prototype.getTimestamp = function(coll_index, doc_index){
	
	return moment.utc(this._timeseries[coll_index][doc_index][this.getTimestampField(coll_index)], this.getTimestampFormat(coll_index), true);
}

tsproc.prototype.getTimestampField = function(coll_index){
	
	return this._config[coll_index].timestamp.field;
}

//FIXME: delete mb
tsproc.prototype.getTimestampFormat = function(coll_index){
	
	return this._config[coll_index].timestamp.format;
}

tsproc.prototype.getDoc = function(coll_index, doc_index){
	
	return this._timeseries[coll_index][doc_index];
}

tsproc.prototype.getEmptyDoc = function(coll_index, doc_index){

	//clone the doc
	var doc = JSON.parse(JSON.stringify(this.getDoc(coll_index, doc_index)));

	//initialize all the values to zero
	this.getFields(coll_index).forEach(function(field, index){

		doc[field] = 0;
	});

	return doc;
}

//date is an iso string
tsproc.prototype.getDocByDate = function(coll_index, date, callback){

	var n = this.getTSSize(coll_index);

	//to moment.js date
	var moment_date = moment.utc(date, ISO_FORMAT, true);
	if (!moment_date.isValid()){

		callback(new Error('Invalid date'), null);
		return;
	}

	var diff;
	for (var i=0; i<n; i++){

		diff = this.getTimestamp(coll_index, i).diff(moment_date);

		if (diff == 0){

			callback(null, this.getDoc(coll_index, i));
			return;
		}
	}

	callback(null, null);
}

tsproc.prototype.getFields = function(coll_index){
	
	var fields = this._config[coll_index].fields;
	var i,n = fields.length;
	var fields_out = [];

	for (i=0; i<n; i++){
		fields_out.push(fields[i].field);	
	}
	
	return fields_out;
}

//check weather the timeseries have the same
//period of timestamps
//FIXME: crashing when used after interpolation
tsproc.prototype.isHomogeneous = function(){

	var i,n = this.getNbTS();
	if (n === 1) return true;

	//array of TS sizes
	var sizes = new Array(n);
	for (i=0; i<n; i++){

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
		for (i=0; i<n; i++){

			dates.push(this.getTimestamp(i, i1).toISOString());
			dates.push(this.getTimestamp(i, i2).toISOString());
			dates.push(this.getTimestamp(i, i3).toISOString());
		}
		
		if (underscore.uniq(dates).length === 3){
			return true;
		}
	}

	return false;
}

tsproc.prototype.isISO = function(){

	var n = this.getNbTS();
	for (var i=0; i<n; i++){

		if (this.getTimestampFormat(i) != ISO_FORMAT)
			return false;
	}

	return true;
}

//pass all the dates to the 
//utc standrart format
//pass the dates to iso format
tsproc.prototype.toUTC = function(callback){
	
	var i,j,date;

	//number of timeseries
	var m,n = this._timeseries.length;

	for (i=0; i<n; i++){
		
		//number of documents in collection
		m = this._timeseries[i].length;

		for (j=0; j<m; j++){
			
			//get date in iso
			date = moment.utc(this._timeseries[i][j][this._config[i].timestamp.field], this._config[i].timestamp.format, true);

			//set date
			this._timeseries[i][j][this._config[i].timestamp.field] = date.toISOString();
		}
		
		this._config[i].timestamp.format = ISO_FORMAT;
	}

	callback(null, this.getData());
}

//leave only the documents between the 
//specified borders	
//borders should be an iso string
tsproc.prototype.cut = function(date_borders, callback){

	var min_date, max_date;

	//time borders are specified
	if (date_borders){

		min_date = moment.utc(date_borders[0], ISO_FORMAT, true);
		max_date = moment.utc(date_borders[1], ISO_FORMAT, true);
	}
	//time borders are specified
	else{

		min_date = getMinDate.call(this);
		max_date = getMaxDate.call(this);
	}

	if (!min_date.isValid() || !max_date.isValid()){

		callback(new Error('Invalid borders'), null);
		return;
	}

	//cut everything out of bounderies
	//gaps are ignored
	cutBellowMin.call(this, min_date);
	cutAboveMax.call(this, max_date);

	callback(null, this.getData());
}

//if there is only one TS, returns it
tsproc.prototype.merge = function(callback){

	var i,j,doc,time;

	//number of timeseries queried
	var m = this.getNbTS();
	if (m === 1) return this._timeseries[0];

	if(this.isHomogeneous()){

		//fusing fields document by document
		var n = this._timeseries[0].length;
		var merged_timeseries = [];
		for (j=0; j<n; j++){

			//fusing fields into one document
			doc = {};
			time = this.getDoc(0,j)[this.getTimestampField(0)]; //save date before deleting
			for (i=0; i<m; i++){
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

		//merge the config
		mergeConfigs.call(this);

	}

	callback(null, this.getData());
}

tsproc.prototype.undersample = function(type, skipsize, target_field, callback){

	if(skipsize && skipsize > 1){

		if(!type) type = 0;

		var reduced_timseries = ReduceFunc[type].call(this, skipsize, target_field);
		if(reduced_timseries){
			
			this._timeseries = reduced_timseries;

		}

	}

	callback(null, this.getData());
}

//type [0..3] = type of interploation
	//FIXME: ignore if there is only one collection
tsproc.prototype.interpolate = function(type, callback){

	var n = this.getNbTS();
	var smooth_conf={};
	var smoothers = new Array(n);

	//check date formats
	for (var i=0; i<n; i++){

		if (this._config[i].timestamp.format != ISO_FORMAT){//iso date format
			
			callback(new Error('Dates should have iso format'), null);
			return;
		}
	}

	//configurate collection interpolation
	smooth_conf.fields = [];
	smooth_conf.type = type;

	//learn the datapoints of each collection
	for (var i=0; i<n; i++){
		
		//config
		smooth_conf.timestamp_field = this.getTimestampField(i);
		this.getFields(i).forEach(function(field, index, array){
			smooth_conf.fields.push({'field': field});
		});
		
		//learn the collection
		smoothers[i] = new tsinterp(this._timeseries[i], smooth_conf, function(err){
			
			if(err) {callback(err, null); i=n;}
		});
				
		//empty config
		smooth_conf.fields = [];
	}

	//get all the possible dates
	var all_dates = getAllDates.call(this);
	var m = all_dates.length;

	//interpolate all timeseries
	var new_timeseries = new Array(n);
	for (var i=0; i<n; i++){
		
		new_timeseries[i] = [];
		for (var j=0; j<m; j++){

			//new_timeseries[i].push(smoothers[i].get(all_dates[j]));
			smoothers[i].smooth(all_dates[j], function(err, doc){

				if (err) { callback(err, null); i=n; j=m; }
				if (doc) new_timeseries[i].push(doc);
			});
		}
	}
	this._timeseries = new_timeseries;

	callback(null, this.getData());
}

tsproc.prototype.intersect = function(callback){

	//get the dates that
	//are used in every collection
	var dates = getSameDates.call(this);

	//nb of timeseries and dates
	var n = this.getNbTS();
	var m = dates.length;

	var new_timeseries = new Array(n);
	for (var i=0; i<n; i++){

		new_timeseries[i] = [];
		for (var j=0; j<m; j++){

			this.getDocByDate(i, dates[j], function(err, doc){

				if (err) { callback(err, null); i=n; j=n; }
				if (doc) new_timeseries[i].push(doc);
			});
		}
	}
	this._timeseries = new_timeseries;
	
	callback(null, this.getData());
}

function reduceSkip(skipsize){

	if (this.isHomogeneous()){

		var n = this.getNbTS();
		var reduced_timeseries = new Array(n);

		//undersample each timeseries
		for (var i=0; i<n; i++){

			reduced_timeseries[i] = [];
			var m = this.getTSSize(i);
			for (var j=0; j<m; j+=skipsize){

				reduced_timeseries[i].push(this.getDoc(i,j));
			}
		}
		
		return reduced_timeseries;
	}

	return null;
}

function reduceSum(skipsize){

	if (this.isHomogeneous()){

		var n = this.getNbTS();
		var reduced_timeseries = new Array(n);
		var summed_doc, doc;

		//undersample each timeseries
		for (var i=0; i<n; i++){

			//sum each quantom
			reduced_timeseries[i] = [];
			var m = this.getTSSize(i);
			for (var j=0; j<m; j+=skipsize){

				//summing the values
				summed_doc = this.getEmptyDoc(i,j);
				for (var k=j; k<j+skipsize; k++){

					if (k >= m) break;

					doc = this.getDoc(i, k);
					this.getFields(i).forEach(function(field, index){

						summed_doc[field] += doc[field];
					});				
				}

				//save summed doc
				reduced_timeseries[i].push(summed_doc);
			}
		}

		return reduced_timeseries;
	}

	return null;
}

function reduceAvg(skipsize){

	if (this.isHomogeneous()){

		var n = this.getNbTS();
		var reduced_timeseries = new Array(n);
		var avg_doc, doc;

		//undersample each timeseries
		for (var i=0; i<n; i++){

			//sum each quantom
			reduced_timeseries[i] = [];
			var m = this.getTSSize(i);
			for (var j=0; j<m; j+=skipsize){

				//summing the values
				avg_doc = this.getEmptyDoc(i,j);
				for (var k=j; k<j+skipsize; k++){

					if (k >= m) break;

					doc = this.getDoc(i, k);
					this.getFields(i).forEach(function(field, index){

						avg_doc[field] += doc[field];
					});				
				}

				//calculate average
				this.getFields(i).forEach(function(field, index){

					avg_doc[field] = avg_doc[field] / (k-j);
				});	

				//save average doc
				reduced_timeseries[i].push(avg_doc);
			}
		}

		return reduced_timeseries;
	}

	return null;
}

function reduceMax(skipsize, target_field){

	if (this.isHomogeneous()){

		var n = this.getNbTS();
		var reduced_timeseries = new Array(n);
		var max_doc, doc;

		//undersample each timeseries
		for (var i=0; i<n; i++){

			//go through each quantom
			reduced_timeseries[i] = [];
			var m = this.getTSSize(i);
			for (var j=0; j<m; j+=skipsize){

				//get the max
				max_doc = this.getDoc(i,j);
				for (var k=j+1; k<j+skipsize; k++){

					if (k >= m) break;

					doc = this.getDoc(i,k);
					if (max_doc[target_field] < doc[target_field])
						max_doc = doc;

				}

				//save summed doc
				reduced_timeseries[i].push(max_doc);
			}
		}

		return reduced_timeseries;
	}

	return null;
}

function reduceMin(skipsize, target_field){

	if (this.isHomogeneous()){

		var n = this.getNbTS();
		var reduced_timeseries = new Array(n);
		var min_doc, doc;

		//undersample each timeseries
		for (var i=0; i<n; i++){

			//go through each quantom
			reduced_timeseries[i] = [];
			var m = this.getTSSize(i);
			for (var j=0; j<m; j+=skipsize){

				//get the min
				min_doc = this.getDoc(i,j);
				for (var k=j+1; k<j+skipsize; k++){

					if (k >= m) break;

					doc = this.getDoc(i,k);
					if (min_doc[target_field] > doc[target_field])
						min_doc = doc;

				}

				//save summed doc
				reduced_timeseries[i].push(min_doc);
			}
		}

		return reduced_timeseries;
	}

	return null;
}

function mergeConfigs(){

	//only if the timeseries are 
	//homogeneous
	if (this.isHomogeneous()){

		var new_config = [{}];

		//copy the timestamp
		new_config[0].timestamp = this._config[0].timestamp;
		
		//copy the fields
		var n = this._config.length;
		var fields = [];
		for (var i=0; i<n; i++){

			this.getFields(i).forEach(function(field, index){

				fields.push({'field': field});
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
	var n = this.getNbTS();

	//getting the minimal dates of each collection
	var dates = new Array(n);
	for (i=0; i<n; i++){
			
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
	var n = this.getNbTS();

	//getting the maximal dates of each collection
	var dates = new Array(n);
	for (i=0; i<n; i++){
			
		dates[i] = this.getTimestamp(i, this.getTSSize(i) - 1);
	}
	
	//returning the max date
	return moment.max(dates);
}

//cut all the elements bellow index (index included)
function cutBellow(coll_index, index){

	this._timeseries[coll_index] = this._timeseries[coll_index].slice(index);

}

//cut all the elements above the index (index included)
function cutAbove(coll_index, index){
	
	this._timeseries[coll_index] = this._timeseries[coll_index].slice(0, index+1);
}

//cut all the dates above the max_date
//if there are gaps after max_date, ignore them
function cutAboveMax(max_date){

	var i,j;
	
	//number of timeseries queried
	var m,n = this.getNbTS();

	//difference between current date and min_date
	var diff;	
	
	//date from collection
	var tmp,date;
	
	//cut documents above max_date
	//of all timeseries
	for (i=0; i<n; i++){

		//iterate through documents and check the date
		m = this.getTSSize(i);
		for (j=m-1; j>=0; j--){

			//date from collection
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
			
			//date from collection is less than max_date
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
	var m,n = this.getNbTS();

	//difference between current date and min_date
	var diff;	
	
	//date from collection
	var date;
	
	//cut documents bellow min_date
	//of all timeseries
	for (i=0; i<n; i++){

		//iterate through documents and check the date
		m = this.getTSSize(i);
		for (j=0; j<m; j++){

			//date from collection
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
			
			//date from collection is bigger than min_date
			//documents missing
			if (diff < 0){
			
				break;
			}
		}
	}
}

//all the possible string utc dates
//of all the timeseries
//sorting is applyed
function getAllDates(){
	
	var n = this.getNbTS();
	var all_dates = [];

	for (var i=0; i<n; i++){
		
		all_dates = underscore.union(all_dates, getCollDates.call(this, i));
	}	
	
	//sort by date
	all_dates = underscore.sortBy(all_dates, function(d){

		return moment.utc(d, null, true).valueOf();
	});

	return all_dates;
}

//returns the dates that 
//are present in each collection
function getSameDates(){
	
	var n = this.getNbTS();
	var same_dates = getCollDates.call(this, 0);

	for (var i=1; i<n; i++){

		same_dates = underscore.intersection(same_dates, getCollDates.call(this, i));
	}

	return same_dates;
}

//returns an array with all the dates
//from the collection
function getCollDates(coll_index){
	
	var field = this._config[coll_index].timestamp.field;

	var dates_array = new Array(this._timeseries[coll_index].length);
	
	this._timeseries[coll_index].forEach(function(document, index, array){
		
		dates_array[index] = document[field];
	});

	return dates_array;
}

module.exports = tsproc;
