Extension { #name : 'TdComparisonTable' }

{ #category : '*TapeDeck-Inspector' }
TdComparisonTable >> inspectionRows [

	<inspectorPresentationOrder: 0 title: 'Comparison'>
	^ SpTablePresenter new
		  items: self rows;
		  addColumn: ((SpStringTableColumn title: 'Task' evaluated: [ :row | row task asString ])
				   width: 50;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Split' evaluated: [ :row | row split asString ])
				   width: 70;
				   yourself);
		  addColumn: (SpStringTableColumn title: 'Baseline' evaluated: [ :row | row baselinePass printString ]);
		  addColumn: (SpStringTableColumn title: 'Fork' evaluated: [ :row | row forkPass printString ]);
		  addColumn: (SpStringTableColumn title: 'Fork at' evaluated: [ :row | row forkAt printString ]);
		  addColumn: (SpStringTableColumn title: 'Reruns' evaluated: [ :row | row rerunPasses printString ]);
		  addColumn: (SpStringTableColumn title: 'Agree' evaluated: [ :row | row agree printString ]);
		  addColumn: (SpStringTableColumn title: 'Fork tokens' evaluated: [ :row | row forkUsage totalTokens printString ]);
		  addColumn: (SpStringTableColumn title: 'Rerun tokens' evaluated: [ :row | row rerunUsage totalTokens printString ]);
		  yourself
]

{ #category : '*TapeDeck-Inspector' }
TdComparisonTable >> inspectionSummary [

	<inspectorPresentationOrder: 1 title: 'Summary'>
	^ SpTextPresenter new
		  text: (TdJson toStringPretty: self summaryDictionary);
		  beNotEditable;
		  yourself
]
