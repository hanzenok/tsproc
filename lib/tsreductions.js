//functions should be called this way:
//reduceSkip.call(this, 5);

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

	if (this.isHomogeneous() && target_field){

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

	if (this.isHomogeneous() && target_field){

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

module.exports = [reduceSkip, reduceSum, reduceAvg, reduceMax, reduceMin];