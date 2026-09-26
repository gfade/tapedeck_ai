Extension { #name : 'TdStore' }

{ #category : '*TapeDeck-GT' }
TdStore >> gtRunsFor: aView [

	<gtView>
	^ aView columnedList
		  title: 'Runs';
		  priority: 10;
		  items: [ self runs ];
		  column: 'Run' text: [ :run | run id asString ];
		  column: 'Task' text: [ :run | run task asString ] width: 50;
		  column: 'Variant' text: [ :run | run variant asString ] width: 130;
		  column: 'Kind' text: [ :run | run kind asString ] width: 60;
		  column: 'Verdict' text: [ :run | run verdictString ] width: 60;
		  column: 'Steps' text: [ :run | run stepCount printString ] width: 50;
		  column: 'Tokens' text: [ :run | run tokens printString ] width: 70;
		  column: 'Cost' text: [ :run | run usage costString ] width: 70
]
