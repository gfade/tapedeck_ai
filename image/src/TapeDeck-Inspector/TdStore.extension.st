Extension { #name : 'TdStore' }

{ #category : '*TapeDeck-Inspector' }
TdStore >> inspectionRuns [

	<inspectorPresentationOrder: 0 title: 'Runs'>
	^ SpTablePresenter new
		  items: self runs;
		  addColumn: (SpStringTableColumn title: 'Run' evaluated: [ :run | run id asString ]);
		  addColumn: ((SpStringTableColumn title: 'Task' evaluated: [ :run | run task asString ])
				   width: 50;
				   yourself);
		  addColumn: (SpStringTableColumn title: 'Variant' evaluated: [ :run | run variant asString ]);
		  addColumn: ((SpStringTableColumn title: 'Kind' evaluated: [ :run | run kind asString ])
				   width: 60;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Verdict' evaluated: [ :run | run verdictString ])
				   width: 60;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Steps' evaluated: [ :run | run stepCount printString ])
				   width: 50;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Tokens' evaluated: [ :run | run tokens printString ])
				   width: 70;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Cost' evaluated: [ :run | run usage costString ])
				   width: 70;
				   yourself);
		  yourself
]
