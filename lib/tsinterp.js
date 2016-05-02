var moment = require('moment');
var underscore = require('underscore');
var smooth = require('./smooth');

//interpolation methods
var METHODS = ['linear', 'cubic', 'lanczos', 'nearest'];

/*
dates has to be of Moment.js type
dates should be sorted
description is a JSON with following format:
{'timestamp_field': moment_js_date,
'fields': [{'field': 'field_name'},{'field': 'field_name2'}]
'smooth_type': 'linear',
'clip_type': 'zero'}
https://github.com/osuushi/Smooth.js/
sdf*/
function tsinterp(collection, description, callback){
	
	//checks
	if (collection == undefined || description == undefined){
		callback(new Error('Collection and it\'s description should be defined'));
		return;
	}
	
	if (collection.length < 2){
		callback(new Error('Collection should have multiple documents'));
		return;
	}

	if (description.timestamp_field == undefined || description.fields == undefined){
		callback(new Error('Description is invalid'));
		return;
	}
	
	for (var document in collection){

		if (!moment.utc(document[description.timestamp_field], null, true).isValid()){
			
			callback(new Error('Timestamps are not valid'));
			return;
		}
	}


	//check type
	if (description.type == undefined || typeof description.type != 'number' || description.type < 0 || description.type > 3)
		description.type = 0;

	//private members
	this._collection = collection;
	this._n = collection.length;
	this._timestamp_field = description.timestamp_field;
	this._fields = description.fields;
	this._clip_type = description.clip_type;
	this._interp_type = METHODS[description.type];

	//extract an array of fields and dates
	//from collection
	this._values_array = extractValues.call(this);
	this._dates_array = extractDates.call(this);

	//learn the datapoints
	this._learned = false; //wheather the datapoints were learned
	learn.call(this, callback);

	callback(null);
}

tsinterp.prototype.smooth = function(date, callback){

	//checks
	if (!date){
		
		callback(new Error('Date is unset'), null);
		return;
	}

	if (!moment.utc(date, null, true).isValid()){

		callback(new Error('Date is not valid'), null);
		return;
	}

	if (this._learned == false){

		callback(new Error('Datapoints are not learned yet'), null);
		return;
	}
	
	//date to moment.js date
	var moment_date = moment.utc(date, null, true);

	//check the exterieur dates
	var min_date = this._dates_array[0];
	if (min_date.diff(moment_date) > 0){

		callback(null, createDoc.call(this, date, this._smooth(-1))); 
		return;
	}
	var max_date = this._dates_array[this._n - 1];
	if (max_date.diff(moment_date) < 0){

		callback(null, createDoc.call(this, date, this._smooth(this._n)));
		return;
	}

	//determine where to insert the date
	var i=0,diff;
	do{
		diff = this._dates_array[i].diff(moment_date);
		i++;
	}while (diff < 0);


	//date is in the collection
	if (diff == 0){

		callback(null, createDoc.call(this, date, this._smooth(i-1))); 
		return;
	}

	//calculate the index to interpolate
	var delta = this._dates_array[i-1].diff(this._dates_array[i-2]);
	var index = i - 2 + (delta - diff)/delta;

	callback(null, createDoc.call(this, date, this._smooth(index)));
}

tsinterp.prototype.getType = function(index){
	
	if (!index || index<0 || index > 3)
		return METHODS[0];

	return METHODS[index];
}

//time is an iso string
function createDoc(time, values){
	
	var doc = {};
	
	//timestamp field
	doc[this._timestamp_field] = time;
	
	//other fields
	this._fields.forEach(function(field, index, array){
		
		doc[field.field] = values[index];
	});
	
	return doc;
}

//extract an array with all the moment.js dates
//[{date: 1911, a: 2, b: 4},{date: 1912, a: 3, b: 1}] ==> [1911, 1912]]
function extractDates(){

	dates_array = new Array(this._n);

	//extracting
	for (var i=0; i<this._n; i++){

		dates_array[i] = moment.utc(this._collection[i][this._timestamp_field], null, true);
	}

	return dates_array;
}

//extract an array with all fields
//[{date: 1911, a: 2, b: 4},{date: 1912, a: 3, b: 1}] ==> [[2, 4], [3, 1]]
function extractValues(){

	values_array = new Array(this._n);

	//number of fields
	var m = this._fields.length;

	//extracting
	var tmp;
	for (var i=0; i<this._n; i++){

		tmp = [];
		for (var j=0; j<m; j++){
		
			tmp.push(this._collection[i][this._fields[j].field]);
		}

		values_array[i] = tmp;
	}

	return values_array;
}

//learn the array
function learn(callback){

	this._learned = true;

	try{
		this._smooth = new smooth.Smooth(this._values_array, {method: this._interp_type, clip: 'zero', lanczosFilterSize: 4});
	}
	catch(err){

		this._learned = false;
		callback(err);
	}
}

module.exports = tsinterp;
