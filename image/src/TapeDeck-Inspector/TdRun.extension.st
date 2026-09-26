Extension { #name : 'TdRun' }

{ #category : '*TapeDeck-Inspector' }
TdRun >> inspectionHarnessDiff [
	"What my variant changed in the harness (against my parent), or how the harness changed during the run."

	<inspectorPresentationOrder: 1 title: 'Harness diff'>
	^ self harnessDiff inspectionChanges
]

{ #category : '*TapeDeck-Inspector' }
TdRun >> inspectionTimeline [

	<inspectorPresentationOrder: 0 title: 'Timeline'>
	^ SpTablePresenter new
		  items: self steps;
		  addColumn: ((SpStringTableColumn title: 'Step' evaluated: [ :step | step index printString ])
				   width: 40;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Live' evaluated: [ :step | step liveString ])
				   width: 70;
				   yourself);
		  addColumn: (SpStringTableColumn title: 'Tools' evaluated: [ :step | step toolSummary ]);
		  addColumn: ((SpStringTableColumn title: 'Tokens' evaluated: [ :step | step tokens printString ])
				   width: 70;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Cost' evaluated: [ :step | step costString ])
				   width: 70;
				   yourself);
		  addColumn: (SpStringTableColumn title: 'Divergence' evaluated: [ :step | step divergenceMarker ]);
		  yourself
]
