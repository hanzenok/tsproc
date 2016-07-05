/**
 * @module tsproc
 */

/**
 * Class contaning the size reduction functions
 * used by the tsproc class.
 *
 * @class tsreductions
 */

/**
 * Reduction of the timeseries size by choosing one document 
 * (allways the first one) from the set of documents.
 *
 * @method reduceSkip
 * @for tsreductions
 * @param {int} skipsize A number of documents to choose from
 * @return {timeseries} Size reduced timeseries
 * @example
 *     var reduced_timseries = reduceSkip.call(this, 5); //calling from tsproc
 */
function reduceSkip(skipsize){

	if (this.isHomogeneous()){

		var ts_nb = this.getNbTS();
		var reduced_timeseries = new Array(ts_nb);

		//undersample each timeseries
		for (var i=0; i<ts_nb; i++){

			reduced_timeseries[i] = [];
			var ts_size = this.getTSSize(i);
			for (var j=0; j<ts_size; j+=skipsize){

				reduced_timeseries[i].push(this.getDoc(i,j));
			}
		}

		return reduced_timeseries;
	}

	return null;
}

/**
 * Reduction of the timeseries size 
 * by summing the values of all the
 * fields in a set of documents.
 *
 * @method reduceSum
 * @for tsreductions
 * @param {int} skipsize A number of documents to
 * be reduced into one by summing
 * @return {timeseries} Size reduced timeseries
 * @example
 *     var reduced_timseries = reduceSum.call(this, 5); //calling from tsproc
 */
function reduceSum(skipsize){

	if (this.isHomogeneous()){

		var nb_ts = this.getNbTS();
		var reduced_timeseries = new Array(nb_ts);
		var summed_doc, doc;

		//undersample each timeseries
		for (var i=0; i<nb_ts; i++){

			//sum each quantom
			reduced_timeseries[i] = [];
			var ts_size = this.getTSSize(i);
			for (var j=0; j<ts_size; j+=skipsize){

				//summing the values
				summed_doc = this.getEmptyDoc(i,j);
				for (var k=j; k<j+skipsize; k++){

					if (k >= ts_size) break;

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

/**
 * Reduction of the timeseries size 
 * by averaging the values of all the
 * fields in a set of documents.
 *
 * @method reduceAvg
 * @for tsreductions
 * @param {int} skipsize A number of documents to
 * be reduced into one by averaging
 * @return {timeseries} Size reduced timeseries
 * @example
 *     var reduced_timseries = reduceAvg.call(this, 5); //calling from tsproc
 */
function reduceAvg(skipsize){

	if (this.isHomogeneous()){

		var nb_ts = this.getNbTS();
		var reduced_timeseries = new Array(nb_ts);
		var avg_doc, doc;

		//undersample each timeseries
		for (var i=0; i<nb_ts; i++){

			//sum each quantom
			reduced_timeseries[i] = [];
			var ts_size = this.getTSSize(i);
			for (var j=0; j<ts_size; j+=skipsize){

				//summing the values
				avg_doc = this.getEmptyDoc(i,j);
				for (var k=j; k<j+skipsize; k++){

					if (k >= ts_size) break;

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

/**
 * Reduction of the timeseries size by finding the document with
 * the max value of 'target_field' between a set of documents.
 *
 * @method reduceMax
 * @for tsreductions
 * @param {int} skipsize A number of documents to be reduced into one by finding the max
 * @param {string} target_field A field by which all the documents are compared
 * to calculate the max
 * @return {timeseries} Size reduced timeseries
 * @example
 *     var reduced_timseries = reduceMax.call(this, 5, 'temp'); //calling from tsproc
 */
function reduceMax(skipsize, target_field){

	if (this.isHomogeneous() && target_field){

		var nb_ts = this.getNbTS();
		var reduced_timeseries = new Array(nb_ts);
		var max_doc, doc;

		//undersample each timeseries
		for (var i=0; i<nb_ts; i++){

			//go through each quantom
			reduced_timeseries[i] = [];
			var ts_size = this.getTSSize(i);
			for (var j=0; j<ts_size; j+=skipsize){

				//get the max
				max_doc = this.getDoc(i,j);
				for (var k=j+1; k<j+skipsize; k++){

					if (k >= ts_size) break;

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

/**
 * Reduction of the timeseries size by finding the document with
 * the min value of 'target_field' between a set of documents.
 *
 * @method reduceMin
 * @for tsreductions
 * @param {int} skipsize A number of documents to be reduced into one by finding the min
 * @param {string} target_field A field by which all the documents are compared
 * to calculate the min
 * @return {timeseries} Size reduced timeseries
 * @example
 *     var reduced_timseries = reduceMin.call(this, 5, 'temp'); //calling from tsproc
 */
function reduceMin(skipsize, target_field){

	if (this.isHomogeneous() && target_field){

		var nb_ts = this.getNbTS();
		var reduced_timeseries = new Array(nb_ts);
		var min_doc, doc;

		//undersample each timeseries
		for (var i=0; i<nb_ts; i++){

			//go through each quantom
			reduced_timeseries[i] = [];
			var ts_size = this.getTSSize(i);
			for (var j=0; j<ts_size; j+=skipsize){

				//get the min
				min_doc = this.getDoc(i,j);
				for (var k=j+1; k<j+skipsize; k++){

					if (k >= ts_size) break;

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

module.exports = [reduceSkip, reduceSum, reduceAvg, reduceMax, reduceMin];
