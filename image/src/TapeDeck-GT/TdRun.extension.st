Extension { #name : 'TdRun' }

{ #category : '*TapeDeck-GT' }
TdRun >> gtHarnessDiffFor: aView [

	<gtView>
	^ self harnessDiff gtChangesFor: aView
]

{ #category : '*TapeDeck-GT' }
TdRun >> gtTimelineFor: aView [

	<gtView>
	^ aView columnedList
		  title: 'Timeline';
		  priority: 10;
		  items: [ self steps ];
		  column: 'Step' text: [ :step | step index printString ] width: 40;
		  column: 'Live' text: [ :step | step liveString ] width: 70;
		  column: 'Tools' text: [ :step | step toolSummary ];
		  column: 'Tokens' text: [ :step | step tokens printString ] width: 70;
		  column: 'Cost' text: [ :step | step costString ] width: 70;
		  column: 'Divergence' text: [ :step | step divergenceMarker ] width: 170
]
