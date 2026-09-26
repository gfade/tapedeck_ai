Extension { #name : 'TdHarnessDiff' }

{ #category : '*TapeDeck-GT' }
TdHarnessDiff >> gtChangesFor: aView [

	<gtView>
	^ aView columnedList
		  title: 'Harness diff';
		  priority: 15;
		  items: [ self changes ];
		  column: '' text: [ :change | change symbol ] width: 20;
		  column: 'Kind' text: [ :change | change subject asString ] width: 60;
		  column: 'Name' text: [ :change | change name asString ] width: 160;
		  column: 'After' text: [ :change | change afterSummary ]
]
