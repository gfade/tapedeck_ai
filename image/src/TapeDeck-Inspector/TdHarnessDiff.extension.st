Extension { #name : 'TdHarnessDiff' }

{ #category : '*TapeDeck-Inspector' }
TdHarnessDiff >> inspectionChanges [

	<inspectorPresentationOrder: 0 title: 'Changes'>
	^ SpTablePresenter new
		  items: self changes;
		  addColumn: ((SpStringTableColumn title: '' evaluated: [ :change | change symbol ])
				   width: 20;
				   yourself);
		  addColumn: ((SpStringTableColumn title: 'Kind' evaluated: [ :change | change subject asString ])
				   width: 60;
				   yourself);
		  addColumn: (SpStringTableColumn title: 'Name' evaluated: [ :change | change name asString ]);
		  addColumn: (SpStringTableColumn title: 'Before' evaluated: [ :change | change beforeSummary ]);
		  addColumn: (SpStringTableColumn title: 'After' evaluated: [ :change | change afterSummary ]);
		  yourself
]
