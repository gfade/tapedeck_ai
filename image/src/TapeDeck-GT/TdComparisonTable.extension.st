Extension { #name : 'TdComparisonTable' }

{ #category : '*TapeDeck-GT' }
TdComparisonTable >> gtRowsFor: aView [

	<gtView>
	^ aView columnedList
		  title: 'Comparison';
		  priority: 10;
		  items: [ self rows ];
		  column: 'Task' text: [ :row | row task asString ] width: 50;
		  column: 'Split' text: [ :row | row split asString ] width: 70;
		  column: 'Baseline' text: [ :row | row baselinePass printString ] width: 70;
		  column: 'Fork' text: [ :row | row forkPass printString ] width: 50;
		  column: 'Fork at' text: [ :row | row forkAt printString ] width: 60;
		  column: 'Reruns' text: [ :row | row rerunPasses printString ];
		  column: 'Agree' text: [ :row | row agree printString ] width: 50;
		  column: 'Fork tokens' text: [ :row | row forkUsage totalTokens printString ] width: 90;
		  column: 'Rerun tokens' text: [ :row | row rerunUsage totalTokens printString ] width: 90
]

{ #category : '*TapeDeck-GT' }
TdComparisonTable >> gtSummaryFor: aView [

	<gtView>
	^ aView textEditor
		  title: 'Summary';
		  priority: 20;
		  text: [ TdJson toStringPretty: self summaryDictionary ]
]
