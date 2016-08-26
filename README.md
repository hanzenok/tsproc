# tsproc

tsproc (Time Series Processor) is a Node.js based data exploration tool that works with multiple timeseries and offers different possibilities to work with it:
- cutting
- merging
- interpolation
- undersampling
- correlation detection
- values and timestamp quantification
- passing the timestamps into ISO format

## Use cases

The module should be used only for timeseries that have a timestamp, the order of dates should be chronological. Interpolation of the timeseries with nominal fields is impossible.

## Usage

In order to import the module locally to your Node.js project add the next line to the dev dependencis of your __package.json__ fie:

```
"devDependencies": {
  "tsproc": "file:../../path_to_tsproc_dir/tsproc"
}
```

The next step is to install tsproc with all it's dependencis (_moment.js_ and _underscore.js_):

```
sudo npm install
```
When it's done, you can require the module in your code:

```
var tsproc = require('tsproc');
```

## Authors

Developped by [Ganza Mykhailo](mailto:hanzenok@gmail.com) with supervision of [François Naçabal](mailto:francois.nacabal@maya-technologies.com) at [Maya Technologies](http://www.maya-technologies.com/en/).
